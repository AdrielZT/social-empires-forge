#!/usr/bin/env python3
"""
Parallel high-fidelity SWF -> WebP Texture Atlas + JSON Pivot/Animation extractor
for Social Empires 1.4.07 (AcidCaos/socialemperors@nerroth-rewrite).

- Decodes DefineBitsJPEG2 / DefineBitsJPEG3 (JPEG + zlib alpha) / DefineBitsJPEG4 /
  DefineBitsLossless / DefineBitsLossless2 (ARGB32 un-premultiplied & colormapped).
- Evaluates DefineShape fill matrices & ShapeBounds + nested DefineSprite PlaceObject2/3
  transform chains to preserve exact Flash registration points (anchorX, anchorY) and
  frame hold timings.
- Deduplicates identical frames per SWF, shelf-packs them into compact WebP atlases,
  and outputs a list of pure-vector SWFs for JPEXS FFDec rasterization.
- Syncs UI rasters (buildingthumbs, images_new, img, externalized) into assets/generated/ui/.
"""
from __future__ import annotations

import concurrent.futures
import io
import json
import lzma
import math
import os
import shutil
import struct
import sys
import time
import zlib
from pathlib import Path
from typing import Any

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
UPSTREAM_DIR = REPO_ROOT / ".cache" / "upstream-socialemperors"
OUT_DIR = REPO_ROOT / "assets" / "generated"
SPRITES_OUT = OUT_DIR / "sprites"
UI_OUT = OUT_DIR / "ui"


class BitReader:
    __slots__ = ("d", "bp")

    def __init__(self, data: bytes, byte_pos: int = 0) -> None:
        self.d = data
        self.bp = byte_pos * 8

    def align(self) -> None:
        r = self.bp & 7
        if r:
            self.bp += 8 - r

    def ub(self, n: int) -> int:
        if n == 0:
            return 0
        bp = self.bp
        byte_off = bp >> 3
        bit_off = bp & 7
        nbytes = (bit_off + n + 7) >> 3
        val = int.from_bytes(self.d[byte_off : byte_off + nbytes], "big")
        shift = (nbytes << 3) - bit_off - n
        self.bp = bp + n
        return (val >> shift) & ((1 << n) - 1)

    def sb(self, n: int) -> int:
        if n == 0:
            return 0
        v = self.ub(n)
        return v - (1 << n) if (v & (1 << (n - 1))) else v

    def fb(self, n: int) -> float:
        return self.sb(n) / 65536.0

    def rect(self) -> tuple[float, float, float, float]:
        nb = self.ub(5)
        x0 = self.sb(nb) / 20.0
        x1 = self.sb(nb) / 20.0
        y0 = self.sb(nb) / 20.0
        y1 = self.sb(nb) / 20.0
        self.align()
        return (x0, y0, x1, y1)

    def matrix(self) -> tuple[float, float, float, float, float, float]:
        sx = sy = 1.0
        r0 = r1 = 0.0
        if self.ub(1):
            nb = self.ub(5)
            sx = self.fb(nb)
            sy = self.fb(nb)
        if self.ub(1):
            nb = self.ub(5)
            r0 = self.fb(nb)
            r1 = self.fb(nb)
        nt = self.ub(5)
        tx = self.sb(nt) / 20.0
        ty = self.sb(nt) / 20.0
        self.align()
        return (sx, sy, r0, r1, tx, ty)

    def byte_pos(self) -> int:
        self.align()
        return self.bp >> 3


def compose_matrix(
    parent: tuple[float, float, float, float, float, float],
    child: tuple[float, float, float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    # Matrix format: (a=sx, d=sy, b=r0, c=r1, tx, ty)
    # [ a c tx ]   [ x ]   [ a*x + c*y + tx ]
    # [ b d ty ] * [ y ] = [ b*x + d*y + ty ]
    pa, pd, pb, pc, ptx, pty = parent
    ca, cd, cb, cc, ctx, cty = child
    return (
        pa * ca + pc * cb,
        pb * cc + pd * cd,
        pb * ca + pd * cb,
        pa * cc + pc * cd,
        pa * ctx + pc * cty + ptx,
        pb * ctx + pd * cty + pty,
    )


def apply_matrix(m: tuple[float, float, float, float, float, float], x: float, y: float) -> tuple[float, float]:
    a, d, b, c, tx, ty = m
    return (a * x + c * y + tx, b * x + d * y + ty)


def clean_jpeg(data: bytes, jpeg_tables: bytes | None = None) -> bytes:
    # Flash sometimes prepends an erroneous FFD9FFD8 or double SOI header
    if data.startswith(b"\xff\xd9\xff\xd8"):
        data = data[4:]
    if jpeg_tables and len(jpeg_tables) >= 4:
        # Strip trailing EOI from tables and leading SOI from data
        t = jpeg_tables[:-2] if jpeg_tables.endswith(b"\xff\xd9") else jpeg_tables
        d = data[2:] if data.startswith(b"\xff\xd8") else data
        return t + d
    return data


def decode_bitmap(tag_type: int, td: bytes, jpeg_tables: bytes | None) -> Image.Image | None:
    if tag_type == 6:  # DefineBits
        raw = clean_jpeg(td[2:], jpeg_tables)
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    if tag_type == 21:  # DefineBitsJPEG2
        raw = clean_jpeg(td[2:])
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    if tag_type in (35, 90):  # DefineBitsJPEG3 / JPEG4
        off = 8 if tag_type == 90 else 6
        alpha_offset = struct.unpack("<I", td[2:6])[0]
        jpg_bytes = clean_jpeg(td[off : off + alpha_offset])
        img = Image.open(io.BytesIO(jpg_bytes)).convert("RGBA")
        alpha_comp = td[off + alpha_offset :]
        if alpha_comp:
            try:
                alpha_raw = zlib.decompress(alpha_comp)
                if len(alpha_raw) >= img.width * img.height:
                    alpha_img = Image.frombytes("L", img.size, alpha_raw[: img.width * img.height])
                    img.putalpha(alpha_img)
            except Exception:
                pass
        return img
    if tag_type in (20, 36):  # DefineBitsLossless / Lossless2
        has_alpha = tag_type == 36
        fmt = td[2]
        w, h = struct.unpack("<HH", td[3:7])
        if w == 0 or h == 0:
            return None
        if fmt == 3:  # Colormapped 8-bit (C-level Pillow palette decode)
            color_count = td[7] + 1
            raw = zlib.decompress(td[8:])
            entry_sz = 4 if has_alpha else 3
            pal_bytes = color_count * entry_sz
            palette = raw[:pal_bytes]
            pixels_raw = raw[pal_bytes:]
            stride = (w + 3) & ~3
            p_img = Image.frombytes("P", (w, h), pixels_raw, "raw", "P", stride, 1)
            rgb_pal = bytearray(256 * 3)
            alpha_lut = [255] * 256
            for i in range(color_count):
                po = i * entry_sz
                r, g, b = palette[po], palette[po + 1], palette[po + 2]
                a = palette[po + 3] if has_alpha else 255
                if has_alpha and 0 < a < 255:
                    r = min(255, (r * 255) // a)
                    g = min(255, (g * 255) // a)
                    b = min(255, (b * 255) // a)
                rgb_pal[i * 3] = r
                rgb_pal[i * 3 + 1] = g
                rgb_pal[i * 3 + 2] = b
                alpha_lut[i] = a
            p_img.putpalette(rgb_pal)
            rgba = p_img.convert("RGBA")
            if has_alpha:
                a_band = p_img.point(alpha_lut, mode="L")
                rgba.putalpha(a_band)
            return rgba
        if fmt == 5:  # 32-bit ARGB (C-level decode + premultiplied RGBa -> RGBA)
            raw = zlib.decompress(td[7:])
            im = Image.frombytes("RGBA", (w, h), raw, "raw", "ARGB")
            if has_alpha:
                r, g, b, a = im.split()
                return Image.merge("RGBa", (r, g, b, a)).convert("RGBA")
            r, g, b, _ = im.split()
            return Image.merge("RGBA", (r, g, b, Image.new("L", (w, h), 255)))
        if fmt == 4:  # 15-bit RGB
            raw = zlib.decompress(td[7:])
            stride = ((w * 2) + 3) & ~3
            out = bytearray(w * h * 4)
            for y in range(h):
                ro = y * stride
                for x in range(w):
                    v = struct.unpack(">H", raw[ro + x * 2 : ro + x * 2 + 2])[0]
                    do = (y * w + x) * 4
                    out[do] = ((v >> 10) & 31) * 255 // 31
                    out[do + 1] = ((v >> 5) & 31) * 255 // 31
                    out[do + 2] = (v & 31) * 255 // 31
                    out[do + 3] = 255
            return Image.frombytes("RGBA", (w, h), bytes(out))
    return None


def parse_shape(tt: int, td: bytes) -> tuple[int, tuple[float, float, float, float], list[tuple[int, tuple[float, float, float, float, float, float]]]]:
    cid = struct.unpack("<H", td[:2])[0]
    br = BitReader(td, 2)
    bounds = br.rect()
    if tt == 83:  # DefineShape4
        br.rect()
        br.ub(8)
    p = br.byte_pos()
    if p >= len(td):
        return cid, bounds, []
    fc = td[p]
    p += 1
    if fc == 0xFF:
        fc = struct.unpack("<H", td[p : p + 2])[0]
        p += 2
    bmps: list[tuple[int, tuple[float, float, float, float, float, float]]] = []
    for _ in range(fc):
        if p >= len(td):
            break
        ft = td[p]
        p += 1
        if ft == 0x00:
            p += 4 if tt in (32, 83) else 3
        elif ft in (0x10, 0x12, 0x13):
            gbr = BitReader(td, p)
            gbr.matrix()
            p = gbr.byte_pos()
            nrec = td[p] & 0x0F
            p += 1
            p += nrec * (5 if tt in (32, 83) else 4)
            if ft == 0x13:
                p += 2
        elif ft in (0x40, 0x41, 0x42, 0x43):
            bid = struct.unpack("<H", td[p : p + 2])[0]
            p += 2
            mbr = BitReader(td, p)
            mat = mbr.matrix()
            p = mbr.byte_pos()
            if bid != 0xFFFF:
                bmps.append((bid, mat))
    return cid, bounds, bmps


def parse_sprite_timeline(td: bytes) -> tuple[int, int, list[list[tuple[int, int, tuple[float, float, float, float, float, float]]]]]:
    cid, fcnt = struct.unpack("<HH", td[:4])
    p = 4
    # Persistent display list by depth across frames
    display: dict[int, tuple[int, tuple[float, float, float, float, float, float]]] = {}
    frames: list[list[tuple[int, int, tuple[float, float, float, float, float, float]]]] = []
    identity = (1.0, 1.0, 0.0, 0.0, 0.0, 0.0)

    while p + 2 <= len(td):
        stc = struct.unpack("<H", td[p : p + 2])[0]
        p += 2
        st, sl = stc >> 6, stc & 0x3F
        if sl == 0x3F:
            sl = struct.unpack("<I", td[p : p + 4])[0]
            p += 4
        sd = td[p : p + sl]
        p += sl
        if st == 1:  # ShowFrame
            snap = [(depth, ch, mat) for depth, (ch, mat) in sorted(display.items())]
            frames.append(snap)
        elif st in (26, 70):  # PlaceObject2 / PlaceObject3
            flags = sd[0]
            off = 2 if st == 70 else 1
            depth = struct.unpack("<H", sd[off : off + 2])[0]
            off += 2
            if st == 70:
                flags2 = sd[1]
                if (flags2 & 0x08) or ((flags2 & 0x10) and (flags & 0x02)):
                    # ClassName null-terminated string
                    end = sd.index(0, off)
                    off = end + 1
            has_move = bool(flags & 0x01)
            has_char = bool(flags & 0x02)
            has_mat = bool(flags & 0x04)
            prev_ch, prev_mat = display.get(depth, (0, identity))
            ch = struct.unpack("<H", sd[off : off + 2])[0] if has_char else prev_ch
            if has_char:
                off += 2
            if has_mat:
                mbr = BitReader(sd, off)
                mat = mbr.matrix()
            else:
                mat = prev_mat if has_move else identity
            if ch != 0:
                display[depth] = (ch, mat)
        elif st == 28:  # RemoveObject2
            depth = struct.unpack("<H", sd[:2])[0]
            display.pop(depth, None)
        elif st == 5:  # RemoveObject
            depth = struct.unpack("<H", sd[2:4])[0]
            display.pop(depth, None)
        elif st == 0:
            break
    return cid, max(1, fcnt), frames


def trim_rgba(im: Image.Image) -> tuple[Image.Image, int, int]:
    bbox = im.getbbox()
    if not bbox:
        return im.crop((0, 0, min(4, im.width), min(4, im.height))), 0, 0
    if bbox == (0, 0, im.width, im.height):
        return im, 0, 0
    return im.crop(bbox), bbox[0], bbox[1]


def shelf_pack(
    items: list[tuple[str, Image.Image]], padding: int = 2, max_dim: int = 2048
) -> tuple[Image.Image, dict[str, tuple[int, int, int, int]], float]:
    if not items:
        return Image.new("RGBA", (4, 4), (0, 0, 0, 0)), {}, 1.0

    raw_area = sum((im.width + padding) * (im.height + padding) for _, im in items)
    max_single = max(max(im.width, im.height) + padding * 2 for _, im in items)
    scale = 1.0
    if raw_area > max_dim * max_dim * 0.72:
        scale = min(scale, math.sqrt((max_dim * max_dim * 0.68) / max(1, raw_area)))
    if max_single > max_dim:
        scale = min(scale, (max_dim - padding * 2) / max_single)

    for _attempt in range(4):
        scaled_items = (
            items
            if scale >= 0.995
            else [
                (k, im.resize((max(1, int(round(im.width * scale))), max(1, int(round(im.height * scale)))), Image.Resampling.BILINEAR))
                for k, im in items
            ]
        )
        ordered = sorted(scaled_items, key=lambda kv: (-kv[1].height, -kv[1].width))
        total_area = sum((im.width + padding) * (im.height + padding) for _, im in ordered)
        max_w = max(im.width + padding * 2 for _, im in ordered)
        target_w = max(max_w, min(max_dim, int(math.ceil(math.sqrt(total_area * 1.18)))))
        target_w = min(max_dim, ((target_w + 3) // 4) * 4)

        placements: dict[str, tuple[int, int, int, int]] = {}
        cur_x = padding
        cur_y = padding
        row_h = 0
        used_w = 0

        for key, im in ordered:
            if cur_x + im.width + padding > target_w and cur_x > padding:
                cur_x = padding
                cur_y += row_h + padding
                row_h = 0
            placements[key] = (cur_x, cur_y, im.width, im.height)
            used_w = max(used_w, cur_x + im.width + padding)
            row_h = max(row_h, im.height)
            cur_x += im.width + padding

        used_h = cur_y + row_h + padding
        atlas_w = max(4, ((used_w + 3) // 4) * 4)
        atlas_h = max(4, ((used_h + 3) // 4) * 4)

        if atlas_w <= max_dim and atlas_h <= max_dim:
            atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
            for key, im in ordered:
                x, y, _, _ = placements[key]
                atlas.paste(im, (x, y))
            return atlas, placements, scale

        shrink = min(0.8, math.sqrt((max_dim * max_dim * 0.72) / max(1, atlas_w * atlas_h)))
        scale *= max(0.3, shrink)

    atlas = Image.new("RGBA", (min(max_dim, atlas_w), min(max_dim, atlas_h)), (0, 0, 0, 0))
    return atlas, placements, scale


def render_leaf_instances(
    char_id: int,
    parent_mat: tuple[float, float, float, float, float, float],
    shapes: dict[int, tuple[tuple[float, float, float, float], list[tuple[int, tuple[float, float, float, float, float, float]]]]],
    sprites: dict[int, tuple[int, list[list[tuple[int, int, tuple[float, float, float, float, float, float]]]]]],
    bitmaps: dict[int, Image.Image],
    subframe_idx: int = 0,
    depth_guard: int = 0,
) -> list[tuple[int, bool, float, float, float, float, float, float]]:
    """
    Returns list of drawable bitmap leaves:
    (bitmap_id, flip_x, scale_x, scale_y, wx0, wy0, wx1, wy1)
    """
    if depth_guard > 8:
        return []
    if char_id in shapes:
        bounds, bmps = shapes[char_id]
        if not bmps:
            return []
        bid, fmat = bmps[-1]
        if bid not in bitmaps:
            return []
        bx0, by0, bx1, by1 = bounds
        corners = [
            apply_matrix(parent_mat, bx0, by0),
            apply_matrix(parent_mat, bx1, by0),
            apply_matrix(parent_mat, bx0, by1),
            apply_matrix(parent_mat, bx1, by1),
        ]
        wx0 = min(c[0] for c in corners)
        wy0 = min(c[1] for c in corners)
        wx1 = max(c[0] for c in corners)
        wy1 = max(c[1] for c in corners)
        fsx = fmat[0] / 20.0
        fsy = fmat[1] / 20.0
        psx = parent_mat[0]
        psy = parent_mat[1]
        flip_x = (fsx < 0) ^ (psx < 0)
        sx = abs(fsx * psx)
        sy = abs(fsy * psy)
        return [(bid, flip_x, sx, sy, wx0, wy0, wx1, wy1)]
    if char_id in sprites:
        _, sframes = sprites[char_id]
        if not sframes:
            return []
        frame = sframes[subframe_idx % len(sframes)]
        leaves = []
        for _, ch, cmat in frame:
            combined = compose_matrix(parent_mat, cmat)
            leaves.extend(
                render_leaf_instances(ch, combined, shapes, sprites, bitmaps, subframe_idx, depth_guard + 1)
            )
        return leaves
    return []


def process_one_swf(args: tuple[str, str, bool]) -> dict[str, Any]:
    swf_str, out_str, force = args
    swf_path = Path(swf_str)
    out_dir = Path(out_str)
    sprite_id = swf_path.stem

    webp_path = out_dir / f"{sprite_id}.webp"
    json_path = out_dir / f"{sprite_id}.atlas.json"
    if not force and webp_path.exists() and json_path.exists() and webp_path.stat().st_size > 0:
        return {
            "id": sprite_id,
            "status": "ok",
            "sourceType": "terrain" if sprite_id.startswith("terreno") or sprite_id == "islandbigboss3" else "bitmap",
            "bytes": webp_path.stat().st_size,
        }

    try:
        with swf_path.open("rb") as f:
            sig = f.read(3)
            _ver = struct.unpack("<B", f.read(1))[0]
            flen = struct.unpack("<I", f.read(4))[0]
            raw = f.read()
        if sig == b"CWS":
            body = zlib.decompress(raw)
        elif sig == b"ZWS":
            body = lzma.decompress(raw[4:9] + struct.pack("<Q", flen - 8) + raw[9:])
        elif sig == b"FWS":
            body = raw
        else:
            return {"id": sprite_id, "status": "error", "reason": f"bad_sig:{sig!r}"}

        br = BitReader(body)
        br.rect()
        idx = br.byte_pos()
        fps_raw, _root_frames = struct.unpack("<HH", body[idx : idx + 4])
        fps = max(1.0, fps_raw / 256.0)
        idx += 4

        jpeg_tables: bytes | None = None
        bitmaps: dict[int, Image.Image] = {}
        shapes: dict[int, tuple[tuple[float, float, float, float], list[tuple[int, tuple[float, float, float, float, float, float]]]]] = {}
        sprites: dict[int, tuple[int, list[list[tuple[int, int, tuple[float, float, float, float, float, float]]]]]] = {}
        symbols: list[tuple[int, str]] = []

        while idx + 2 <= len(body):
            tc = struct.unpack("<H", body[idx : idx + 2])[0]
            idx += 2
            tt, tl = tc >> 6, tc & 0x3F
            if tl == 0x3F:
                tl = struct.unpack("<I", body[idx : idx + 4])[0]
                idx += 4
            td = body[idx : idx + tl]
            idx += tl
            if tt == 8:
                jpeg_tables = td
            elif tt in (6, 20, 21, 35, 36, 90):
                cid = struct.unpack("<H", td[:2])[0]
                im = decode_bitmap(tt, td, jpeg_tables)
                if im is not None:
                    bitmaps[cid] = im
            elif tt in (2, 22, 32, 83):
                cid, bounds, bmps = parse_shape(tt, td)
                shapes[cid] = (bounds, bmps)
            elif tt == 39:
                cid, fcnt, sframes = parse_sprite_timeline(td)
                sprites[cid] = (fcnt, sframes)
            elif tt == 76:
                n = struct.unpack("<H", td[:2])[0]
                p = 2
                for _ in range(n):
                    cid = struct.unpack("<H", td[p : p + 2])[0]
                    p += 2
                    e = td.index(0, p)
                    nm = td[p:e].decode("utf-8", errors="replace")
                    p = e + 1
                    symbols.append((cid, nm))
            elif tt == 0:
                break

        if not bitmaps:
            return {"id": sprite_id, "status": "vector_only", "swf": swf_str}

        main_cid = None
        for cid, nm in symbols:
            if cid in sprites and (nm == sprite_id or nm.lower() == sprite_id.lower()):
                main_cid = cid
                break
        if main_cid is None:
            for cid, _ in symbols:
                if cid in sprites:
                    main_cid = cid
                    break
        if main_cid is None and sprites:
            main_cid = max(sprites.keys(), key=lambda c: sprites[c][0])

        # Pixel deduplication separated from per-frame anchor metadata!
        # pixel_pool[pix_key] = (trimmed_RGBA_Image, trim_dx, trim_dy)
        pixel_pool: dict[str, tuple[Image.Image, int, int]] = {}
        # frame_refs[frame_key] = (pix_key, anchorX, anchorY)
        frame_refs: dict[str, tuple[str, float, float]] = {}
        animations: dict[str, dict[str, Any]] = {}
        root_frame_count = 1
        is_terrain = sprite_id.startswith("terreno") or sprite_id == "islandbigboss3"

        if main_cid is not None and main_cid in sprites:
            _root_fcnt, root_frames = sprites[main_cid]
            root_frame_count = max(1, len(root_frames))

            for r_idx, display_list in enumerate(root_frames):
                anim_len = 1
                for _, ch, _ in display_list:
                    if ch in sprites:
                        anim_len = max(anim_len, len(sprites[ch][1]))

                seq: list[str] = []
                # Probe frame 0 to check if this root clip is multi-part rigged
                probe_leaves = []
                for _, ch, cmat in display_list:
                    probe_leaves.extend(render_leaf_instances(ch, cmat, shapes, sprites, bitmaps, 0))
                is_multipart = len(probe_leaves) > 1
                # Keep full frames for single-bitmap animations; uniformly stride-sample huge multi-part boss rigs
                max_mp_keys = 6 if root_frame_count > 30 else 10
                mp_stride = max(1, math.ceil(anim_len / max_mp_keys)) if is_multipart and anim_len > max_mp_keys else 1
                last_comp_fkey: str | None = None

                for sub_i in range(anim_len):
                    if is_multipart and mp_stride > 1 and (sub_i % mp_stride != 0) and last_comp_fkey is not None:
                        seq.append(last_comp_fkey)
                        continue

                    leaves = probe_leaves if sub_i == 0 else []
                    if sub_i > 0:
                        for _, ch, cmat in display_list:
                            leaves.extend(
                                render_leaf_instances(ch, cmat, shapes, sprites, bitmaps, sub_i)
                            )
                    if not leaves:
                        continue

                    if len(leaves) == 1:
                        bid, flip_x, _sx, _sy, wx0, wy0, wx1, wy1 = leaves[0]
                        src_im = bitmaps[bid]
                        rw = max(1, int(round(wx1 - wx0))) if (wx1 - wx0) > 1 else src_im.width
                        rh = max(1, int(round(wy1 - wy0))) if (wy1 - wy0) > 1 else src_im.height
                        need_resize = abs(rw - src_im.width) > 2 or abs(rh - src_im.height) > 2
                        pix_key = f"p{bid}_{'f' if flip_x else 'n'}_{rw if need_resize else src_im.width}x{rh if need_resize else src_im.height}"
                        if pix_key not in pixel_pool:
                            im = src_im
                            if flip_x:
                                im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                            if need_resize:
                                im = im.resize((rw, rh), Image.Resampling.BILINEAR)
                            if is_terrain:
                                pixel_pool[pix_key] = (im, 0, 0)
                            else:
                                pixel_pool[pix_key] = trim_rgba(im)
                        _, trim_dx, trim_dy = pixel_pool[pix_key]
                        ax = round(-wx0 - trim_dx, 2)
                        ay = round(-wy0 - trim_dy, 2)
                        fkey = f"{pix_key}@{ax},{ay}"
                        if fkey not in frame_refs:
                            frame_refs[fkey] = (pix_key, ax, ay)
                        seq.append(fkey)
                    else:
                        sig_parts = [
                            f"{l[0]}:{int(l[1])}:{int(round(l[4]))},{int(round(l[5]))}"
                            for l in leaves
                        ]
                        pix_key = f"c_{abs(hash('|'.join(sig_parts))) % 100000000}"
                        min_x = math.floor(min(l[4] for l in leaves))
                        min_y = math.floor(min(l[5] for l in leaves))
                        if pix_key not in pixel_pool:
                            max_x = math.ceil(max(l[6] for l in leaves))
                            max_y = math.ceil(max(l[7] for l in leaves))
                            cw = max(1, min(640, max_x - min_x))
                            ch_h = max(1, min(640, max_y - min_y))
                            comp = Image.new("RGBA", (cw, ch_h), (0, 0, 0, 0))
                            for bid, flip_x, _, _, wx0, wy0, wx1, wy1 in leaves:
                                im = bitmaps[bid]
                                if flip_x:
                                    im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                                rw = max(1, int(round(wx1 - wx0)))
                                rh = max(1, int(round(wy1 - wy0)))
                                if abs(rw - im.width) > 2 or abs(rh - im.height) > 2:
                                    im = im.resize((rw, rh), Image.Resampling.BILINEAR)
                                ox = int(round(wx0 - min_x))
                                oy = int(round(wy0 - min_y))
                                if ox < cw and oy < ch_h and ox + im.width > 0 and oy + im.height > 0:
                                    comp.alpha_composite(im, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
                            pixel_pool[pix_key] = trim_rgba(comp)
                        _, trim_dx, trim_dy = pixel_pool[pix_key]
                        ax = round(-min_x - trim_dx, 2)
                        ay = round(-min_y - trim_dy, 2)
                        fkey = f"{pix_key}@{ax},{ay}"
                        if fkey not in frame_refs:
                            frame_refs[fkey] = (pix_key, ax, ay)
                        seq.append(fkey)
                        last_comp_fkey = fkey

                if seq:
                    animations[f"f{r_idx + 1}"] = {"frames": seq, "loop": True}

        if not pixel_pool:
            seq = []
            for bid, im in sorted(bitmaps.items()):
                pix_key = f"raw_{bid}"
                trimmed, dx, dy = (im, 0, 0) if is_terrain else trim_rgba(im)
                pixel_pool[pix_key] = (trimmed, dx, dy)
                frame_refs[pix_key] = (pix_key, round(trimmed.width * 0.5, 2), round(trimmed.height * 0.85, 2))
                seq.append(pix_key)
            animations["f1"] = {"frames": seq, "loop": True}

        pack_list = [(k, v[0]) for k, v in pixel_pool.items()]
        atlas_img, rects, pack_scale = shelf_pack(pack_list, padding=2, max_dim=2168 if is_terrain else 2048)

        webp_name = f"{sprite_id}.webp"
        json_name = f"{sprite_id}.atlas.json"
        atlas_img.save(out_dir / webp_name, "WEBP", quality=85, method=0)

        frames_meta = {}
        for fkey, (pix_key, ax, ay) in frame_refs.items():
            x, y, w, h = rects[pix_key]
            frames_meta[fkey] = {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "anchorX": round(ax * pack_scale, 2),
                "anchorY": round(ay * pack_scale, 2),
            }

        meta = {
            "id": sprite_id,
            "fps": round(fps, 2),
            "atlasImage": f"sprites/{webp_name}",
            "atlasWidth": atlas_img.width,
            "atlasHeight": atlas_img.height,
            "rootFrames": root_frame_count,
            "frames": frames_meta,
            "animations": animations,
        }
        (out_dir / json_name).write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        return {
            "id": sprite_id,
            "status": "ok",
            "sourceType": "terrain" if is_terrain else "bitmap",
            "bytes": (out_dir / webp_name).stat().st_size,
        }
    except Exception as exc:
        return {"id": sprite_id, "status": "error", "reason": f"{type(exc).__name__}:{exc}", "swf": swf_str}


def sync_ui_assets() -> dict[str, int]:
    counts: dict[str, int] = {}
    mapping = [
        ("buildingthumbs", "thumbs"),
        ("images_new", "images_new"),
        ("img", "img"),
        ("externalized", "externalized"),
    ]
    for src_name, dst_name in mapping:
        src = UPSTREAM_DIR / "assets" / src_name
        dst = UI_OUT / dst_name
        if not src.exists():
            counts[dst_name] = 0
            continue
        cnt = 0
        for root_dir, _, files in os.walk(src):
            rel = Path(root_dir).relative_to(src)
            target_dir = dst / rel
            target_dir.mkdir(parents=True, exist_ok=True)
            for fn in files:
                if fn.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                    sp = Path(root_dir) / fn
                    tp = target_dir / fn
                    if not tp.exists() or tp.stat().st_size != sp.stat().st_size:
                        shutil.copy2(sp, tp)
                    cnt += 1
        counts[dst_name] = cnt
    return counts


def main() -> None:
    t0 = time.time()
    bs_dir = UPSTREAM_DIR / "assets" / "buildingsprites"
    if not bs_dir.exists():
        raise FileNotFoundError(f"Missing {bs_dir}. Run 'pnpm assets:sync' first.")

    SPRITES_OUT.mkdir(parents=True, exist_ok=True)
    UI_OUT.mkdir(parents=True, exist_ok=True)

    swfs = sorted(bs_dir.glob("*.swf"), key=lambda p: p.stat().st_size)
    only_filter = os.environ.get("SE_SPRITES_FILTER")
    if only_filter:
        wanted = {s.strip() for s in only_filter.split(",") if s.strip()}
        swfs = [p for p in swfs if p.stem in wanted]

    workers = max(1, min(os.cpu_count() or 4, 8))
    print(f"[extract-sprites] Processing {len(swfs)} SWFs using {workers} workers...")

    force = os.environ.get("SE_SPRITES_FORCE") == "1"
    jobs = [(str(p), str(SPRITES_OUT), force) for p in swfs]
    ok_count = 0
    total_webp_bytes = 0
    vector_only: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as ex:
        for i, res in enumerate(ex.map(process_one_swf, jobs, chunksize=4), 1):
            st = res["status"]
            if st == "ok":
                ok_count += 1
                total_webp_bytes += int(res.get("bytes", 0))
            elif st == "vector_only":
                vector_only.append({"id": res["id"], "swf": res["swf"]})
            else:
                errors.append({"id": res["id"], "reason": str(res.get("reason", ""))})
            if i % 250 == 0 or i == len(swfs):
                print(f"  progress: {i}/{len(swfs)} (ok={ok_count}, vector_only={len(vector_only)}, err={len(errors)})", flush=True)

    ui_counts = sync_ui_assets()
    elapsed = time.time() - t0
    report = {
        "processed": len(swfs),
        "ok": ok_count,
        "vectorOnlyCount": len(vector_only),
        "errorCount": len(errors),
        "totalWebpMB": round(total_webp_bytes / (1024 * 1024), 2),
        "elapsedSec": round(elapsed, 2),
        "uiCounts": ui_counts,
        "vectorOnly": vector_only,
        "errors": errors,
    }
    (OUT_DIR / "sprites-extract-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        f"[extract-sprites] Done in {elapsed:.1f}s: ok={ok_count}, vector_only={len(vector_only)}, "
        f"errors={len(errors)}, webp={report['totalWebpMB']} MB, ui={ui_counts}"
    )


if __name__ == "__main__":
    main()
