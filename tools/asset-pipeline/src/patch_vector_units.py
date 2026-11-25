#!/usr/bin/env python3
"""
Generalized patcher for pure-vector / deeply-nested animated units (e.g. Dragon Nest dragons,
dragon riders, golem, yeti, bosses) whose initial extraction collapsed each state (`f1..fN`)
to 1 static frame because the actual animation lives inside each root frame's child DefineSprite.

Auto-discovers ALL frozen unit atlases (`len(f6) <= 1 and len(f11) <= 1`), maps every root
frame `f1..fN` to its animated child DefineSprite, exports unique child sprites via JPEXS FFDec
in a single FFDec call per SWF, samples cleanly to keep atlases compact (<= 2048px), and updates
the generated `.webp`, `.atlas.json`, and `manifest.json`.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
import os
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path
from typing import Any

from PIL import Image
from extract_sprites import parse_sprite_timeline, shelf_pack
from patch_animated_buildings import (
    ITEMS_JSON_PATH,
    MANIFEST_PATH,
    SPRITES_OUT,
    locate_ffdec_jar,
    locate_upstream_buildingsprites,
    numeric_stem,
)

MAX_FRAMES_PER_CLIP = 8
MAX_UNIT_FRAME_DIM = 220


def inspect_unit_swf_clips(swf_path: Path) -> tuple[float, dict[int, int], dict[int, int]]:
    """
    Returns (fps, frame_idx_to_child_cid, child_cid_to_frame_count) for a unit SWF.
    frame_idx is 1-based (`f1..fN`).
    """
    raw = swf_path.read_bytes()
    if raw[:3] == b"CWS":
        data = b"FWS" + raw[3:8] + zlib.decompress(raw[8:])
    elif raw[:3] == b"FWS":
        data = raw
    else:
        return 24.0, {}, {}

    nbits = data[8] >> 3
    rect_bytes = (5 + nbits * 4 + 7) // 8
    fps_raw = struct.unpack_from("<H", data, 8 + rect_bytes)[0]
    fps = max(8.0, min(30.0, fps_raw / 256.0)) if fps_raw > 0 else 24.0
    pos = 8 + rect_bytes + 4

    sprites: dict[int, tuple[int, list[list[tuple[int, int, tuple[float, float, float, float, float, float]]]]]] = {}
    symbols: list[tuple[int, str]] = []

    while pos + 2 <= len(data):
        hdr = struct.unpack_from("<H", data, pos)[0]
        pos += 2
        tt, tl = hdr >> 6, hdr & 0x3F
        if tl == 0x3F:
            if pos + 4 > len(data):
                break
            tl = struct.unpack_from("<I", data, pos)[0]
            pos += 4
        if pos + tl > len(data):
            break
        td = data[pos : pos + tl]
        pos += tl
        if tt == 39:
            cid, fcnt, sf = parse_sprite_timeline(td)
            sprites[cid] = (max(fcnt, len(sf)), sf)
        elif tt == 76 and len(td) >= 2:
            n = struct.unpack_from("<H", td, 0)[0]
            p = 2
            for _ in range(n):
                if p + 2 > len(td):
                    break
                cid = struct.unpack_from("<H", td, p)[0]
                p += 2
                try:
                    e = td.index(0, p)
                except ValueError:
                    break
                nm = td[p:e].decode("utf-8", errors="replace")
                p = e + 1
                symbols.append((cid, nm))
        elif tt == 0:
            break

    stem_lower = swf_path.stem.lower()
    root_cid = next((cid for cid, nm in symbols if cid in sprites and nm.lower() == stem_lower), None)
    if root_cid is None:
        root_cid = next((cid for cid, nm in symbols if cid in sprites and cid != 0), None)
    if root_cid is None:
        return fps, {}, {}

    _rf, rsf = sprites[root_cid]
    frame_to_cid: dict[int, int] = {}
    cid_fcnt: dict[int, int] = {}

    for idx, frame_objs in enumerate(rsf, 1):
        # Descend 1-2 levels if wrapped in a single-frame container
        children = [ch for _, ch, _ in frame_objs if ch in sprites]
        if not children:
            continue
        best_ch = max(children, key=lambda c: sprites[c][0])
        # If best_ch has 1 frame and wraps a single animated DefineSprite, descend once
        if sprites[best_ch][0] <= 1 and sprites[best_ch][1]:
            sub_children = [ch for _, ch, _ in sprites[best_ch][1][0] if ch in sprites]
            if sub_children:
                best_ch = max(sub_children, key=lambda c: sprites[c][0])
        frame_to_cid[idx] = best_ch
        cid_fcnt[best_ch] = sprites[best_ch][0]

    return fps, frame_to_cid, cid_fcnt


def discover_frozen_unit_sprites() -> list[str]:
    """Auto-discovers ALL unit sprites whose atlas currently has 1-frame walk & attack clips."""
    if not ITEMS_JSON_PATH.exists():
        return []
    items = json.loads(ITEMS_JSON_PATH.read_text(encoding="utf-8"))
    unit_imgs = sorted({i["imgName"] for i in items if i.get("type") == "u" and i.get("imgName")})
    force = os.environ.get("SE_UNIT_ANIM_FORCE") == "1"
    frozen: list[str] = []
    for img in unit_imgs:
        p = SPRITES_OUT / f"{img}.atlas.json"
        if not p.exists():
            continue
        if force:
            frozen.append(img)
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            anims = d.get("animations", {})
            f6 = len(anims.get("f6", {}).get("frames", []))
            f11 = len(anims.get("f11", {}).get("frames", []))
            if f6 <= 1 and f11 <= 1 and len(anims) >= 6:
                frozen.append(img)
        except Exception:
            continue
    return frozen


def export_and_pack_unit(sprite_id: str, swf_path: Path, ffdec_jar: Path) -> dict[str, Any] | None:
    fps, frame_to_cid, cid_fcnt = inspect_unit_swf_clips(swf_path)
    if not frame_to_cid:
        return None
    # Require at least one animated child sprite (> 1 frame)
    if max(cid_fcnt.values(), default=1) <= 1:
        return None

    # Prioritize core gameplay states: f1..f5 (idle), f6..f10 (walk), f11..f15 (attack), f16..f20 (die)
    # so complex dragons with 30+ special sub-sprites export cleanly in ~10-15s without FFDec timeouts.
    core_cids = {cid for fidx, cid in frame_to_cid.items() if 1 <= fidx <= 20}
    if not core_cids:
        core_cids = set(frame_to_cid.values())
    selected_cids = sorted(core_cids)
    select_arg = ",".join(str(c) for c in selected_cids)

    with tempfile.TemporaryDirectory(prefix=f"sef_unit_{sprite_id}_") as tmp:
        out_dir = Path(tmp)
        try:
            subprocess.run(
                [
                    "java",
                    "-Xmx1g",
                    "-jar",
                    str(ffdec_jar),
                    "-selectid",
                    select_arg,
                    "-format",
                    "sprite:png",
                    "-export",
                    "sprite",
                    str(out_dir),
                    str(swf_path),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=120,
            )
        except Exception as exc:
            print(f"[patch-vector-units] WARN FFDec failed for {sprite_id}: {exc}")
            return None

        # Map DefineSprite_<cid> -> list of PNGs
        cid_to_pngs: dict[int, list[Path]] = {}
        for d in out_dir.iterdir():
            if not d.is_dir():
                continue
            parts = d.name.split("_")
            if len(parts) >= 2 and parts[1].isdigit():
                cid = int(parts[1])
                pngs = sorted(d.glob("*.png"), key=numeric_stem)
                if pngs:
                    cid_to_pngs[cid] = pngs

        if not cid_to_pngs:
            return None

        # Load and uniformly sample each unique cid clip (consistent union bbox per clip -> zero jitter)
        imgs: list[tuple[str, Image.Image]] = []
        anchors: dict[str, tuple[float, float]] = {}
        cid_frame_keys: dict[int, list[str]] = {}

        # Limit max frames per clip dynamically if there are many unique clips
        max_per_clip = MAX_FRAMES_PER_CLIP if len(cid_to_pngs) <= 22 else 6

        for cid, pngs in sorted(cid_to_pngs.items()):
            stride = max(1, math.ceil(len(pngs) / max_per_clip))
            sampled = pngs[::stride]
            if len(pngs) > 1 and len(sampled) < 2:
                sampled = [pngs[0], pngs[-1]]

            loaded: list[Image.Image] = []
            union_bbox: list[int] | None = None
            for p in sampled:
                try:
                    im = Image.open(p).convert("RGBA")
                    loaded.append(im)
                    bb = im.getbbox()
                    if bb:
                        if union_bbox is None:
                            union_bbox = [bb[0], bb[1], bb[2], bb[3]]
                        else:
                            union_bbox[0] = min(union_bbox[0], bb[0])
                            union_bbox[1] = min(union_bbox[1], bb[1])
                            union_bbox[2] = max(union_bbox[2], bb[2])
                            union_bbox[3] = max(union_bbox[3], bb[3])
                except Exception:
                    continue

            if not loaded or union_bbox is None:
                continue

            ux0, uy0, ux1, uy1 = union_bbox
            clip_keys: list[str] = []
            for fi, im in enumerate(loaded, 1):
                c = im.crop((ux0, uy0, ux1, uy1))
                if max(c.width, c.height) > MAX_UNIT_FRAME_DIM:
                    s = MAX_UNIT_FRAME_DIM / max(c.width, c.height)
                    c = c.resize((max(1, int(c.width * s)), max(1, int(c.height * s))), Image.Resampling.LANCZOS)
                key = f"c{cid}_{fi}"
                imgs.append((key, c))
                anchors[key] = (round(c.width * 0.5, 2), round(c.height * 0.88, 2))
                clip_keys.append(key)
            cid_frame_keys[cid] = clip_keys

        if not imgs:
            return None

        animations: dict[str, dict[str, Any]] = {}
        for fidx, cid in sorted(frame_to_cid.items()):
            keys = cid_frame_keys.get(cid)
            if not keys:
                continue
            # Die frames (16..20) do not loop; idle/walk/attack/specials loop cleanly
            is_die = 16 <= fidx <= 20
            animations[f"f{fidx}"] = {"frames": keys, "loop": not is_die}

        if not animations:
            return None

        atlas, rects, scale = shelf_pack(imgs, padding=2, max_dim=2048)
        webp_name = f"{sprite_id}.webp"
        json_name = f"{sprite_id}.atlas.json"
        atlas.save(SPRITES_OUT / webp_name, "WEBP", quality=80, method=1)

        eff_fps = round(max(8.0, min(18.0, fps * 0.55)), 1)
        frames_meta = {
            k: {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "anchorX": round(anchors[k][0] * scale, 2),
                "anchorY": round(anchors[k][1] * scale, 2),
            }
            for k, (x, y, w, h) in rects.items()
        }
        meta = {
            "id": sprite_id,
            "fps": eff_fps,
            "atlasImage": f"sprites/{webp_name}",
            "atlasWidth": atlas.width,
            "atlasHeight": atlas.height,
            "rootFrames": len(animations),
            "frames": frames_meta,
            "animations": animations,
        }
        (SPRITES_OUT / json_name).write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        return {
            "id": sprite_id,
            "clips": len(animations),
            "frames": len(imgs),
            "f6": len(animations.get("f6", {}).get("frames", [])),
            "f11": len(animations.get("f11", {}).get("frames", [])),
            "bytes": (SPRITES_OUT / webp_name).stat().st_size,
            "scale": round(scale, 3),
        }


def update_manifest_hashes(patched_ids: list[str]) -> None:
    if not MANIFEST_PATH.exists() or not patched_ids:
        return
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        sprites = manifest.get("sprites", {})
        for sid in patched_ids:
            webp = SPRITES_OUT / f"{sid}.webp"
            if webp.exists():
                sha = hashlib.sha256(webp.read_bytes()).hexdigest()
                sprites[sid] = {
                    "atlasJson": f"sprites/{sid}.atlas.json",
                    "atlasImage": f"sprites/{sid}.webp",
                    "sha256": sha,
                    "sourceType": "vector",
                }
        manifest["sprites"] = sprites
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"[patch-vector-units] WARN updating manifest: {exc}")


def main() -> None:
    SPRITES_OUT.mkdir(parents=True, exist_ok=True)
    bs_dir = locate_upstream_buildingsprites()
    ffdec_jar = locate_ffdec_jar()
    if not bs_dir or not ffdec_jar:
        print(f"[patch-vector-units] Skipping (upstream={bs_dir}, ffdec={ffdec_jar}).")
        return

    frozen = discover_frozen_unit_sprites()
    print(f"[patch-vector-units] Found {len(frozen)} frozen unit sprites to animate via FFDec...")
    patched_ids: list[str] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {}
        for sid in frozen:
            swf = bs_dir / f"{sid}.swf"
            if swf.exists():
                futs[pool.submit(export_and_pack_unit, sid, swf, ffdec_jar)] = sid
        for fut in as_completed(futs):
            sid = futs[fut]
            try:
                res = fut.result()
                if res:
                    patched_ids.append(sid)
                    print(
                        f"  patched {sid}: {res['clips']} clips, {res['frames']} frames "
                        f"(f6={res['f6']}, f11={res['f11']}, {res['bytes'] // 1024} KB, scale={res['scale']})"
                    )
            except Exception as exc:
                print(f"  WARN {sid}: {exc}")

    update_manifest_hashes(patched_ids)
    print(f"[patch-vector-units] Done: {len(patched_ids)}/{len(frozen)} unit sprites animated.")


if __name__ == "__main__":
    main()
