#!/usr/bin/env python3
"""
Packs PNG frames exported by JPEXS FFDec for pure-vector SWFs into standard
WebP Texture Atlases + .atlas.json files inside assets/generated/sprites/.
"""
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image
from extract_sprites import shelf_pack

REPO_ROOT = Path(__file__).resolve().parents[3]
VEC_TMP = REPO_ROOT / ".cache" / "vector-frames"
SPRITES_OUT = REPO_ROOT / "assets" / "generated" / "sprites"


def strip_opaque_white_bg(im: Image.Image) -> Image.Image:
    """Safety net if an SWF lacked a DefineSprite and fell back to stage frame export."""
    w, h = im.size
    if w < 4 or h < 4:
        return im
    corners = [im.getpixel((0, 0)), im.getpixel((w - 1, 0)), im.getpixel((0, h - 1)), im.getpixel((w - 1, h - 1))]
    if not all(c[3] == 255 and c[0] >= 250 and c[1] >= 250 and c[2] >= 250 for c in corners):
        return im
    px = im.load()
    visited = bytearray(w * h)
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        r, g, b, a = px[x, y]
        if a > 0 and r >= 245 and g >= 245 and b >= 245:
            px[x, y] = (0, 0, 0, 0)
            if x > 0:
                stack.append((x - 1, y))
            if x + 1 < w:
                stack.append((x + 1, y))
            if y > 0:
                stack.append((x, y - 1))
            if y + 1 < h:
                stack.append((x, y + 1))
    return im


def numeric_stem(p: Path) -> int:
    try:
        return int(p.stem)
    except ValueError:
        return 999999


def main() -> None:
    if not VEC_TMP.exists():
        return
    SPRITES_OUT.mkdir(parents=True, exist_ok=True)
    packed = 0
    for sub in sorted(VEC_TMP.iterdir()):
        if not sub.is_dir():
            continue
        sprite_id = sub.name
        # Prefer the exported DefineSprite_* folder with the most frames if multiple exist
        sprite_dirs = [d for d in sub.iterdir() if d.is_dir()]
        if sprite_dirs:
            best_dir = max(sprite_dirs, key=lambda d: len(list(d.glob("*.png"))))
            pngs = sorted(best_dir.glob("*.png"), key=numeric_stem)
        else:
            pngs = sorted(sub.rglob("*.png"), key=numeric_stem)
        if not pngs:
            continue
        imgs: list[tuple[str, Image.Image]] = []
        anchors: dict[str, tuple[float, float]] = {}
        animations: dict[str, dict[str, object]] = {}
        for i, p in enumerate(pngs[:64], 1):
            try:
                im = Image.open(p).convert("RGBA")
                im = strip_opaque_white_bg(im)
                bbox = im.getbbox()
                if bbox:
                    im = im.crop(bbox)
                # Cap individual oversized vector renders to 260px max dim so dragons scale cleanly with bitmap sprites
                if max(im.width, im.height) > 260:
                    s = 260.0 / max(im.width, im.height)
                    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.Resampling.LANCZOS)
                key = f"v{i}"
                imgs.append((key, im))
                anchors[key] = (round(im.width * 0.5, 2), round(im.height * 0.88, 2))
                animations[f"f{i}"] = {"frames": [key], "loop": True}
            except Exception:
                continue
        if not imgs:
            continue
        atlas, rects, scale = shelf_pack(imgs, padding=2, max_dim=2048)
        webp_name = f"{sprite_id}.webp"
        json_name = f"{sprite_id}.atlas.json"
        atlas.save(SPRITES_OUT / webp_name, "WEBP", quality=85, method=0)
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
            "fps": 24,
            "atlasImage": f"sprites/{webp_name}",
            "atlasWidth": atlas.width,
            "atlasHeight": atlas.height,
            "rootFrames": len(imgs),
            "frames": frames_meta,
            "animations": animations,
        }
        (SPRITES_OUT / json_name).write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        packed += 1
    print(f"[pack-vector-frames] Packed {packed} transparent vector sprites into WebP atlases.")


if __name__ == "__main__":
    main()
