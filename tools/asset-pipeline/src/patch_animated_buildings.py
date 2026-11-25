#!/usr/bin/env python3
"""
Patches nested-animated special building sprites (hybrid bitmap+vector SWFs like
1233_criadero Dragon Nest, 1255_monsternest, 1529_soulMixer, etc.) using JPEXS FFDec
transparent DefineSprite export, and tags farm/tree atlases with canonical `animMode`.

Runs in ~15-25 seconds on top of an existing `assets/generated/` directory so both local
dev and GitHub Pages CI stay ultra-fast at $0 cost.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path
from typing import Any

from PIL import Image
from extract_sprites import parse_sprite_timeline, shelf_pack

REPO_ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = REPO_ROOT / ".cache"
SPRITES_OUT = REPO_ROOT / "assets" / "generated" / "sprites"
MANIFEST_PATH = REPO_ROOT / "assets" / "generated" / "manifest.json"

# Priority nested-animated buildings (depth >= 2 DefineSprite animations & hybrid vector rigs)
ANIMATED_SPECIAL_BUILDINGS = [
    "1233_criadero",
    "1255_monsternest",
    "1284_unit_warehouse",
    "1299_cash_wonder",
    "1345_dragonrider_training",
    "1346_dragon_taming",
    "1394_temple_invocation_bahamut_supreme",
    "1529_soulMixer",
    "1226_angelmolino",
    "1236_molino",
    "1256_mill",
    "1463_time_machine",
]

MAX_ANIM_FRAMES = 16


def locate_upstream_buildingsprites() -> Path | None:
    candidates = [
        Path(os.environ["SE_UPSTREAM_DIR"]) / "assets" / "buildingsprites"
        if os.environ.get("SE_UPSTREAM_DIR")
        else None,
        CACHE_DIR / "upstream-socialemperors" / "assets" / "buildingsprites",
        CACHE_DIR / "upstream" / "assets" / "buildingsprites",
        Path("/tmp/se-canonical-research/upstream/assets/buildingsprites"),
    ]
    for c in candidates:
        if c and c.exists():
            return c
    return None


def locate_ffdec_jar() -> Path | None:
    candidates = [
        Path(os.environ["SE_FFDEC_JAR"]) if os.environ.get("SE_FFDEC_JAR") else None,
        CACHE_DIR / "tools" / "ffdec" / "ffdec.jar",
        Path("/tmp/se-canonical-research/ffdec/ffdec.jar"),
    ]
    for c in candidates:
        if c and c.exists():
            return c
    return None


def inspect_swf_nested_sprite(swf_path: Path) -> tuple[float, int | None, int]:
    """
    Returns (fps, best_animated_define_sprite_cid, frame_count) for a building SWF.
    Walks DefineSprite tags and selects the animated nested DefineSprite with the most frames.
    """
    raw = swf_path.read_bytes()
    if raw[:3] == b"CWS":
        data = b"FWS" + raw[3:8] + zlib.decompress(raw[8:])
    elif raw[:3] == b"FWS":
        data = raw
    else:
        return 24.0, None, 1

    nbits = data[8] >> 3
    rect_bytes = (5 + nbits * 4 + 7) // 8
    fps_raw = struct.unpack_from("<H", data, 8 + rect_bytes)[0]
    fps = max(8.0, min(30.0, fps_raw / 256.0)) if fps_raw > 0 else 24.0
    pos = 8 + rect_bytes + 4

    sprites: dict[int, int] = {}
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
            sprites[cid] = max(fcnt, len(sf))
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

    root_cids = {cid for cid, _ in symbols}
    # Prefer a non-root DefineSprite with > 2 frames (orientation roots typically have 2 frames)
    nested_candidates = [(cid, cnt) for cid, cnt in sprites.items() if cid not in root_cids and cnt > 2]
    if nested_candidates:
        best_cid, best_cnt = max(nested_candidates, key=lambda x: x[1])
        return fps, best_cid, best_cnt

    all_candidates = [(cid, cnt) for cid, cnt in sprites.items() if cnt > 2]
    if all_candidates:
        best_cid, best_cnt = max(all_candidates, key=lambda x: x[1])
        return fps, best_cid, best_cnt

    return fps, None, 1


def numeric_stem(p: Path) -> int:
    try:
        return int(p.stem)
    except ValueError:
        return 999999


def export_and_pack_building(sprite_id: str, swf_path: Path, ffdec_jar: Path) -> dict[str, Any] | None:
    fps, best_cid, frame_count = inspect_swf_nested_sprite(swf_path)
    if best_cid is None or frame_count <= 2:
        return None

    with tempfile.TemporaryDirectory(prefix=f"sef_anim_{sprite_id}_") as tmp:
        out_dir = Path(tmp)
        try:
            subprocess.run(
                [
                    "java",
                    "-Xmx1g",
                    "-jar",
                    str(ffdec_jar),
                    "-selectid",
                    str(best_cid),
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
                timeout=60,
            )
        except Exception as exc:
            print(f"[patch-animated-buildings] WARN: FFDec failed for {sprite_id} (cid={best_cid}): {exc}")
            return None

        pngs = sorted(out_dir.rglob("*.png"), key=numeric_stem)
        if len(pngs) < 2:
            return None

        # Uniform stride sampling so large 90+ frame animations stay compact (~<=16 frames)
        stride = max(1, math.ceil(len(pngs) / MAX_ANIM_FRAMES))
        sampled_paths = pngs[::stride]
        if len(sampled_paths) < 2:
            sampled_paths = pngs[:2]

        loaded: list[Image.Image] = []
        union_bbox: list[int] | None = None
        for p in sampled_paths:
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

        if not loaded or union_bbox is None:
            return None

        ux0, uy0, ux1, uy1 = union_bbox
        # Crop every frame to the EXACT same union box -> zero animation jitter!
        cropped_imgs: list[tuple[str, Image.Image]] = []
        frame_keys: list[str] = []
        for idx, im in enumerate(loaded, 1):
            c = im.crop((ux0, uy0, ux1, uy1))
            key = f"a{idx}"
            cropped_imgs.append((key, c))
            frame_keys.append(key)

        atlas, rects, scale = shelf_pack(cropped_imgs, padding=2, max_dim=2048)
        webp_name = f"{sprite_id}.webp"
        json_name = f"{sprite_id}.atlas.json"
        atlas.save(SPRITES_OUT / webp_name, "WEBP", quality=82, method=1)

        eff_fps = round(max(6.0, min(20.0, fps / stride)), 1)
        frames_meta = {
            k: {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "anchorX": 0.0,
                "anchorY": 0.0,
            }
            for k, (x, y, w, h) in rects.items()
        }
        meta = {
            "id": sprite_id,
            "fps": eff_fps,
            "atlasImage": f"sprites/{webp_name}",
            "atlasWidth": atlas.width,
            "atlasHeight": atlas.height,
            "rootFrames": 1,
            "animMode": "loop",
            "frames": frames_meta,
            "animations": {
                "f1": {"frames": frame_keys, "loop": True},
            },
        }
        (SPRITES_OUT / json_name).write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        return {
            "id": sprite_id,
            "frames": len(frame_keys),
            "fps": eff_fps,
            "bytes": (SPRITES_OUT / webp_name).stat().st_size,
            "scale": round(scale, 3),
        }


def tag_farm_and_tree_atlases() -> tuple[int, int]:
    farms = 0
    trees = 0
    if not SPRITES_OUT.exists():
        return 0, 0
    for jf in sorted(SPRITES_OUT.glob("*.atlas.json")):
        stem = jf.name.replace(".atlas.json", "")
        mode: str | None = None
        if stem.startswith("granja") or stem == "vinedo":
            mode = "farm"
        elif stem.startswith("arbol"):
            mode = "tree"
        elif stem.startswith("rancho"):
            mode = "ranch"
        if not mode:
            continue
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
            if data.get("animMode") != mode:
                data["animMode"] = mode
                jf.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
            if mode == "farm":
                farms += 1
            elif mode == "tree":
                trees += 1
        except Exception:
            continue
    return farms, trees


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
        print(f"[patch-animated-buildings] WARN updating manifest: {exc}")


def main() -> None:
    SPRITES_OUT.mkdir(parents=True, exist_ok=True)
    farms, trees = tag_farm_and_tree_atlases()
    print(f"[patch-animated-buildings] Tagged animMode on {farms} farms and {trees} trees.")

    bs_dir = locate_upstream_buildingsprites()
    ffdec_jar = locate_ffdec_jar()
    if not bs_dir or not ffdec_jar:
        print(
            f"[patch-animated-buildings] Skipping FFDec animated patch "
            f"(upstream={bs_dir}, ffdec={ffdec_jar})."
        )
        return

    force = os.environ.get("SE_ANIM_FORCE") == "1"
    patched_ids: list[str] = []
    for sid in ANIMATED_SPECIAL_BUILDINGS:
        swf = bs_dir / f"{sid}.swf"
        if not swf.exists():
            continue
        atlas_json = SPRITES_OUT / f"{sid}.atlas.json"
        if not force and atlas_json.exists():
            try:
                cur = json.loads(atlas_json.read_text(encoding="utf-8"))
                if cur.get("animMode") == "loop" and len(cur.get("animations", {}).get("f1", {}).get("frames", [])) > 1:
                    continue
            except Exception:
                pass
        res = export_and_pack_building(sid, swf, ffdec_jar)
        if res:
            patched_ids.append(sid)
            print(
                f"  patched {sid}: {res['frames']} frames @ {res['fps']}fps "
                f"({res['bytes'] // 1024} KB, scale={res['scale']})"
            )

    update_manifest_hashes(patched_ids)
    print(f"[patch-animated-buildings] Done: {len(patched_ids)} animated special buildings patched.")


if __name__ == "__main__":
    main()
