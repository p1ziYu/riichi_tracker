#!/usr/bin/env python3
"""Build the bundled LXGW WenKai Screen font for the native apps.

Source: LXGWWenKaiScreen.ttf, official release v1.530
(https://github.com/lxgw/LxgwWenKai-Screen/releases/tag/v1.530, OFL-1.1).

The previous bundled file was a 291-character display subset: any UI
character outside it (e.g. 机/逐/细/扫/描 and the punctuation 、；：！（）)
fell back per-glyph to the system font, so whole screens rendered in a
mixed WenKai/system face. This build subsets the full font to the
GB2312 repertoire + every character used in the iOS/Android/Web UI
sources + kana and the full CJK punctuation/fullwidth ranges
(~8,000 glyphs, ~3.6 MB), and renames it to the identifiers the apps
already reference (family "LXGW WenKai Screen R", PS "LXGWWenKaiScreenR").

Punctuation metrics patch: in LXGW WenKai, sentence punctuation ink is a
small mark at the lower-left of a 1 em cell (U+FF0C ink spans 9.5%-23.7%
of the em), leaving ~0.75 em of trailing blank inside body text — the
"落座，[gap]即开局。" defect. For ，。、；：？！ this build enlarges the
ink (~0.38 em wide), keeps it hugging the left of the cell, and trims
the advance to ink + ~0.08 em, matching the visual density of system
CJK punctuation without changing any copy or the glyphs' identity.
"""
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

PUNCT = ["，", "。", "、", "；", "：", "？", "！"]
TARGET_INK_W = 780      # units @ upem 2048 (~0.38 em)
INK_LEFT = 150          # ink xMin after patch (~0.07 em)
ADV_TAIL = 170          # blank after ink (~0.08 em)


def build(source: Path, ui_char_files: list[Path], out: Path) -> None:
    chars: set[str] = set()
    for path in ui_char_files:
        chars |= set(path.read_text(encoding="utf-8"))
    for cp in range(0x3400, 0xA000):  # GB2312 repertoire via codec round-trip
        ch = chr(cp)
        try:
            if ch.encode("gb2312").decode("gb2312") == ch:
                chars.add(ch)
        except Exception:
            pass
    text = "".join(sorted(c for c in chars if ord(c) >= 0x2000 or c == "·"))
    tmp = out.parent / "_chars.txt"
    tmp.write_text(text, encoding="utf-8")
    unicodes = ",".join([
        "U+0020-007E", "U+00A0-00FF", "U+2000-206F", "U+2190-21FF",
        "U+3000-303F", "U+3040-30FF", "U+FF00-FF65", "U+2600-26FF",
    ])
    raw = out.parent / "_wenkai_raw.ttf"
    subprocess.run([
        sys.executable, "-m", "fontTools.subset", str(source),
        f"--output-file={raw}", f"--text-file={tmp}", f"--unicodes={unicodes}",
        "--name-IDs=*", "--layout-features=*", "--hinting",
    ], check=True)

    font = TTFont(str(raw))
    glyf = font["glyf"]
    cmap = font.getBestCmap()
    for ch in PUNCT:
        gname = cmap.get(ord(ch))
        if gname is None:
            raise SystemExit(f"punctuation {ch} missing from subset")
        glyph = glyf[gname]
        if glyph.isComposite():
            glyph.expand(glyf)
        coords, end_pts, flags = glyph.getCoordinates(glyf)
        xs = [x for x, _ in coords]
        ys = [y for _, y in coords]
        ink_w = max(xs) - min(xs)
        ink_h = max(ys) - min(ys)
        # Uniform scale toward the target ink width, but never let a tall
        # narrow mark (e.g. ！；) grow beyond ~0.93 em in height.
        scale = max(1.0, min(2.2, TARGET_INK_W / ink_w, 1900 / ink_h))
        scaled = [(round(x * scale), round(y * scale)) for x, y in coords]
        shift = INK_LEFT - min(x for x, _ in scaled)
        new_coords = [(x + shift, y) for x, y in scaled]
        glyph.coordinates = type(coords)(new_coords)
        glyph.endPtsOfContours = end_pts
        glyph.flags = flags
        glyph.recalcBounds(glyf)
        advance = max(x for x, _ in new_coords) + ADV_TAIL
        font["hmtx"][gname] = (advance, glyph.xMin)

    names = {1: "LXGW WenKai Screen R", 2: "Regular", 3: "LXGW WenKai Screen R:2026",
             4: "LXGW WenKai Screen R", 6: "LXGWWenKaiScreenR",
             16: "LXGW WenKai Screen R", 17: "Regular"}
    for nid, val in names.items():
        font["name"].setName(val, nid, 3, 1, 0x409)
        font["name"].setName(val, nid, 1, 0, 0)
    font.save(str(out))
    tmp.unlink(missing_ok=True)
    raw.unlink(missing_ok=True)


if __name__ == "__main__":
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    ui_files = [Path(p) for p in sys.argv[3:]]
    build(src, ui_files, out)
    f = TTFont(str(out))
    print(f"wrote {out} ({out.stat().st_size} bytes, {f['maxp'].numGlyphs} glyphs)")
