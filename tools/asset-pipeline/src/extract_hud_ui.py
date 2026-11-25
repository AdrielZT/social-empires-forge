#!/usr/bin/env python3
"""
Extracts authentic Social Empires 1.4.07 HUD sprites (IconResourcesMC, StoreButtonGraphic,
PanelCollection, AddCashButton, MenuTabFriendsMC, IconCollect, IconoCapturadoMC) from
`SocialEmpires1.4.07sec_fixed.swf` into `assets/generated/ui/hud/*.webp`.
Idempotent: skips extraction if all expected WebP files already exist.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = REPO_ROOT / ".cache"
HUD_OUT = REPO_ROOT / "assets" / "generated" / "ui" / "hud"

EXPECTED_FILES = [
    "btn_store.webp",
    "btn_collections.webp",
    "btn_add_cash.webp",
    "friends_tab.webp",
    "icon_collect.webp",
    "icon_captured.webp",
    "res_1.webp",
    "res_2.webp",
    "res_3.webp",
    "res_4.webp",
    "res_5.webp",
    "res_6.webp",
    "res_8.webp",
]


def locate_main_swf() -> Path | None:
    candidates = [
        Path(os.environ["SE_UPSTREAM_DIR"]) / "assets" / "flash" / "SocialEmpires1.4.07sec_fixed.swf"
        if os.environ.get("SE_UPSTREAM_DIR")
        else None,
        CACHE_DIR / "upstream-socialemperors" / "assets" / "flash" / "SocialEmpires1.4.07sec_fixed.swf",
        CACHE_DIR / "upstream" / "assets" / "flash" / "SocialEmpires1.4.07sec_fixed.swf",
        Path("/tmp/se-canonical-research/upstream/assets/flash/SocialEmpires1.4.07sec_fixed.swf"),
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


def main() -> None:
    HUD_OUT.mkdir(parents=True, exist_ok=True)
    if os.environ.get("SE_HUD_FORCE") != "1" and all((HUD_OUT / f).exists() for f in EXPECTED_FILES):
        print("[extract-hud-ui] Authentic 1.4.07 HUD sprites already present; skipping.")
        return

    swf = locate_main_swf()
    jar = locate_ffdec_jar()
    if not swf or not jar:
        print(f"[extract-hud-ui] Skipping (swf={swf}, ffdec={jar}).")
        return

    with tempfile.TemporaryDirectory(prefix="sef_hud_") as tmp:
        raw = Path(tmp)
        subprocess.run(
            [
                "java",
                "-Xmx1g",
                "-jar",
                str(jar),
                "-selectid",
                "61,112,257,314,598,1403,1467",
                "-format",
                "sprite:png",
                "-export",
                "sprite",
                str(raw),
                str(swf),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=90,
        )

        mapping = {
            "DefineSprite_112_StoreButtonGraphic_StoreButtonGraphic/1.png": "btn_store.webp",
            "DefineSprite_257_PanelCollection_PanelCollection/1.png": "btn_collections.webp",
            "DefineSprite_314_AddCashButton_AddCashButton/1.png": "btn_add_cash.webp",
            "DefineSprite_598_MenuTabFriendsMC_MenuTabFriendsMC/1.png": "friends_tab.webp",
            "DefineSprite_1403_IconCollect_IconCollect/1.png": "icon_collect.webp",
            "DefineSprite_1467_IconoCapturadoMC_IconoCapturadoMC/1.png": "icon_captured.webp",
        }
        written = 0
        for src, dst in mapping.items():
            p = raw / src
            if p.exists():
                im = Image.open(p).convert("RGBA")
                bb = im.getbbox()
                if bb:
                    im = im.crop(bb)
                im.save(HUD_OUT / dst, "WEBP", quality=90)
                written += 1

        for i in range(1, 12):
            p = raw / f"DefineSprite_61_IconResourcesMC_IconResourcesMC/{i}.png"
            if p.exists():
                im = Image.open(p).convert("RGBA")
                bb = im.getbbox()
                if bb:
                    im = im.crop(bb)
                im.save(HUD_OUT / f"res_{i}.webp", "WEBP", quality=90)
                written += 1

        print(f"[extract-hud-ui] Exported {written} authentic 1.4.07 HUD sprites to {HUD_OUT}.")


if __name__ == "__main__":
    main()
