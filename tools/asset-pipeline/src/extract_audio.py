#!/usr/bin/env python3
"""
Extracts all 35 embedded SFX (DefineSound) from assets/swf/120608_dynamic.swf
and copies the 7 MP3 music tracks from assets/music/ into assets/generated/audio/.
Strips the 2-byte SWF SeekSamples header from MP3 DefineSound tags so standard
browsers and Web Audio API decode every clip cleanly.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import wave
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
UPSTREAM_DIR = REPO_ROOT / ".cache" / "upstream-socialemperors"
OUT_AUDIO_DIR = REPO_ROOT / "assets" / "generated" / "audio"

RATES = {0: 5512, 1: 11025, 2: 22050, 3: 44100}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def read_swf_body(swf_path: Path) -> bytes:
    with swf_path.open("rb") as f:
        sig = f.read(3)
        f.read(5)
        raw = f.read()
    if sig == b"CWS":
        return zlib.decompress(raw)
    if sig == b"FWS":
        return raw
    raise ValueError(f"Unsupported SWF signature {sig!r} in {swf_path}")


def extract_dynamic_sfx(swf_path: Path, sfx_dir: Path) -> dict[str, dict[str, str]]:
    sfx_dir.mkdir(parents=True, exist_ok=True)
    body = read_swf_body(swf_path)
    nbits = body[0] >> 3
    idx = ((5 + 4 * nbits + 7) // 8) + 4

    sounds: dict[int, tuple[int, int, int, int, bytes]] = {}
    symbols: dict[int, str] = {}

    while idx + 2 <= len(body):
        tc = struct.unpack("<H", body[idx : idx + 2])[0]
        idx += 2
        tt, tl = tc >> 6, tc & 0x3F
        if tl == 0x3F:
            tl = struct.unpack("<I", body[idx : idx + 4])[0]
            idx += 4
        td = body[idx : idx + tl]
        idx += tl

        if tt == 14:  # DefineSound
            cid = struct.unpack("<H", td[:2])[0]
            flags = td[2]
            fmt = (flags >> 4) & 0xF
            rate_code = (flags >> 2) & 0x3
            is_16bit = (flags >> 1) & 0x1
            is_stereo = flags & 0x1
            payload = td[7:]  # skip charId(2) + flags(1) + sampleCount(4)
            sounds[cid] = (fmt, RATES.get(rate_code, 44100), is_16bit, is_stereo, payload)
        elif tt == 76:  # SymbolClass
            n = struct.unpack("<H", td[:2])[0]
            p = 2
            for _ in range(n):
                cid = struct.unpack("<H", td[p : p + 2])[0]
                p += 2
                end = td.index(0, p)
                name = td[p:end].decode("utf-8", errors="replace")
                p = end + 1
                symbols[cid] = name
        elif tt == 0:
            break

    index: dict[str, dict[str, str]] = {}
    for cid, (fmt, rate, is_16bit, is_stereo, payload) in sorted(sounds.items()):
        name = symbols.get(cid, f"sound_{cid}")
        safe_name = name.replace("/", "_").replace("\\", "_")
        if fmt == 2:  # MP3 (first 2 bytes are signed SeekSamples in SWF)
            mp3_bytes = payload[2:]
            out_file = sfx_dir / f"{safe_name}.mp3"
            out_file.write_bytes(mp3_bytes)
        elif fmt in (0, 3):  # Uncompressed PCM
            out_file = sfx_dir / f"{safe_name}.wav"
            with wave.open(str(out_file), "wb") as wf:
                wf.setnchannels(2 if is_stereo else 1)
                wf.setsampwidth(2 if is_16bit else 1)
                wf.setframerate(rate)
                wf.writeframes(payload)
        else:
            out_file = sfx_dir / f"{safe_name}.bin"
            out_file.write_bytes(payload)

        index[name] = {
            "path": f"audio/sfx/{out_file.name}",
            "sha256": sha256_file(out_file),
        }

    return index


def copy_music(music_src: Path, music_dst: Path) -> dict[str, dict[str, str]]:
    music_dst.mkdir(parents=True, exist_ok=True)
    index: dict[str, dict[str, str]] = {}
    for mp3 in sorted(music_src.glob("*.mp3")):
        target = music_dst / mp3.name
        shutil.copy2(mp3, target)
        index[mp3.stem] = {
            "path": f"audio/music/{target.name}",
            "sha256": sha256_file(target),
        }
    return index


def main() -> None:
    dynamic_swf = UPSTREAM_DIR / "assets" / "swf" / "120608_dynamic.swf"
    music_src = UPSTREAM_DIR / "assets" / "music"
    if not dynamic_swf.exists():
        raise FileNotFoundError(f"Missing {dynamic_swf}. Run 'pnpm assets:sync' first.")

    sfx_index = extract_dynamic_sfx(dynamic_swf, OUT_AUDIO_DIR / "sfx")
    music_index = copy_music(music_src, OUT_AUDIO_DIR / "music")

    summary = {"sfx": sfx_index, "music": music_index}
    (OUT_AUDIO_DIR / "audio-index.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"[extract-audio] Extracted {len(sfx_index)} SFX + {len(music_index)} music tracks.")


if __name__ == "__main__":
    main()
