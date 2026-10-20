"""Render the WenKai 東 tile and regenerate web/Capacitor launch assets.

Requires Chromium (headless, --no-sandbox), Pillow, and pnpm-installed web fonts.
Run from the repository root: python3 scripts/generate_brand_assets.py
"""

from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps/web"
RES = WEB / "android/app/src/main/res"
CATALOG = WEB / "ios/App/App/Assets.xcassets"
FONT = WEB / "node_modules/lxgw-wenkai-screen-webfont/files/lxgwwenkaiscreen-subset-102.woff2"
PREVIEW = Path.home() / "riichi-briefs/stageB/icon-preview.png"
NAVY = (16, 28, 40)
GREEN = (23, 87, 58)
IVORY = (247, 242, 228)
SIDE = (14, 62, 44)
SIZE = 2048


def render_glyph():
    # Let Chromium rasterize the same WenKai subset used by the app, not a system CJK fallback.
    with TemporaryDirectory(dir=ROOT, prefix="brand-stage-") as folder:
        stage = Path(folder)
        html = stage / "glyph.html"
        screenshot = stage / "glyph.png"
        html.write_text(f"""<!doctype html><html><head><meta charset='utf-8'><style>
@font-face {{ font-family: WenKai; src: url('{FONT.as_uri()}') format('woff2'); }}
html,body {{ margin:0; width:{SIZE}px; height:{SIZE}px; background:white; }}
body {{ display:grid; place-items:center; }}
span {{ font: 1400px/1 WenKai; color:#17573a; }}
</style></head><body><span>東</span>
<script>document.fonts.load('1400px WenKai','東');</script></body></html>""", encoding="utf-8")
        subprocess.run([
            "chromium", "--headless", "--no-sandbox", "--disable-gpu",
            "--disable-dev-shm-usage", "--hide-scrollbars", "--virtual-time-budget=2000",
            f"--window-size={SIZE},{SIZE}", f"--screenshot={screenshot}", html.as_uri(),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        image = Image.open(screenshot).convert("RGB")
        # On white the green glyph's red channel encodes antialias coverage exactly.
        red = image.getchannel("R")
        mask = red.point(lambda value: round(max(0, min(255, (255 - value) * 255 / (255 - GREEN[0])))))
        bounds = mask.getbbox()
        if bounds is None or bounds[2] - bounds[0] < 400:
            raise RuntimeError("Chromium did not render the WenKai glyph")
        return mask.crop(bounds)


def tile_master(glyph):
    image = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((136, 102, 1952, 1970), radius=318, fill=SIDE)
    draw.rounded_rectangle((100, 68, 1870, 1850), radius=300, fill=IVORY)
    width, height = glyph.size
    factor = min(1330 / width, 1320 / height)
    glyph = glyph.resize((round(width * factor), round(height * factor)), Image.Resampling.LANCZOS)
    colored = Image.new("RGBA", glyph.size, GREEN + (255,))
    image.paste(colored, (985 - glyph.width // 2, 959 - glyph.height // 2), glyph)
    return image


def on_navy(tile, fraction):
    canvas = Image.new("RGB", (SIZE, SIZE), NAVY)
    scaled = tile.resize((round(SIZE * fraction),) * 2, Image.Resampling.LANCZOS)
    canvas.paste(scaled, ((SIZE - scaled.width) // 2, (SIZE - scaled.height) // 2), scaled)
    return canvas


def save(image, filename, size):
    filename.parent.mkdir(parents=True, exist_ok=True)
    image.resize(size, Image.Resampling.LANCZOS).save(filename, optimize=True)
    print(f"{filename.relative_to(ROOT) if filename.is_relative_to(ROOT) else filename}: {size[0]}x{size[1]}")


def main():
    if not FONT.is_file():
        raise RuntimeError("Install web dependencies before rendering the WenKai tile")
    tile = tile_master(render_glyph())
    branded = on_navy(tile, 0.826)  # tile occupies ~76% of the navy frame
    save(tile, WEB / "branding/tile-transparent-2048.png", (SIZE, SIZE))
    save(branded, WEB / "branding/tile-navy-2048.png", (SIZE, SIZE))
    public = WEB / "public"
    for px in (16, 32, 48, 180, 192, 512):
        name = f"icon-{px}.png" if px != 180 else "apple-touch-icon.png"
        save(tile, public / name, (px, px))

    ios = CATALOG / "AppIcon.appiconset"
    save(branded, ios / "AppIcon-512@2x.png", (1024, 1024))
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        save(branded, CATALOG / "Splash.imageset" / name, (2732, 2732))

    for density, multiplier in (("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)):
        folder = RES / f"mipmap-{density}"
        px = round(48 * multiplier)
        save(branded, folder / "ic_launcher.png", (px, px))
        round_icon = Image.new("RGBA", (SIZE, SIZE))
        circle = Image.new("L", (SIZE, SIZE))
        ImageDraw.Draw(circle).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=255)
        round_icon.paste(branded, (0, 0), circle)
        save(round_icon, folder / "ic_launcher_round.png", (px, px))
        foreground = Image.new("RGBA", (SIZE, SIZE))
        # Adaptive icon safe zone: central 66dp of the 108dp canvas.
        face = tile.resize((round(SIZE * 0.65),) * 2, Image.Resampling.LANCZOS)
        foreground.paste(face, ((SIZE - face.width) // 2, (SIZE - face.height) // 2), face)
        safe_px = round(108 * multiplier)
        save(foreground, folder / "ic_launcher_foreground.png", (safe_px, safe_px))

    # Replace Capacitor's Android launch art at each existing resource resolution.
    for path in sorted(RES.glob("drawable*/splash.png")):
        with Image.open(path) as existing:
            width, height = existing.size
        canvas = Image.new("RGB", (width, height), NAVY)
        extent = round(min(width, height) * 0.72)
        scaled = tile.resize((extent, extent), Image.Resampling.LANCZOS)
        canvas.paste(scaled, ((width - extent) // 2, (height - extent) // 2), scaled)
        canvas.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}: {width}x{height}")

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sizes = (180, 120, 60, 32)
    preview = Image.new("RGB", (900, 560), "#e6e7e7")
    draw = ImageDraw.Draw(preview)
    for row, bg in enumerate((NAVY, (255, 255, 255))):
        y = 20 + row * 270
        draw.rounded_rectangle((20, y, 880, y + 245), radius=15, fill=bg)
        x = 60
        for px in sizes:
            icon = tile.resize((px, px), Image.Resampling.LANCZOS)
            preview.paste(icon, (x, y + 22 + (180 - px) // 2), icon)
            draw.text((x, y + 210), f"{px}px", fill="#e8e3d9" if row == 0 else "#263a40")
            x += px + 55
    preview.save(PREVIEW, optimize=True)
    print(PREVIEW)


if __name__ == "__main__":
    main()
