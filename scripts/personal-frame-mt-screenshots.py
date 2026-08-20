#!/usr/bin/env python3
"""Compose App Store marketing screenshots for MT Code.

Takes raw simulator captures and lays them onto a dark canvas with a benefit
headline so the product page reads more intentionally than bare UI dumps.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Benefit-first copy. Slot 1 leads with the brand.
SCENE_COPY: dict[str, tuple[str, str]] = {
    "threads": ("MT Code", "Coding agents on every project"),
    "thread": ("Continue anywhere", "Same thread on phone or desktop"),
    "terminal": ("Real terminal output", "Run commands from your pocket"),
    "review": ("Review and ship", "Read diffs and approve on the go"),
    "environments": ("Pair in seconds", "Connect MT Code to your Mac or PC"),
}

SCENE_ORDER = ("threads", "thread", "review", "terminal", "environments")


# App Store Connect upload sizes we care about for MT Code.
SIZE_PRESETS = {
    "iphone-6.9": (1320, 2868),
    "iphone-6.5": (1284, 2778),
    "ipad-13": (2752, 2064),
}

# MT Code accent (matches mobile orange).
ACCENT = (255, 107, 44, 255)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    if bold:
        candidates = [
            "/System/Library/Fonts/SFNS.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
        ] + candidates
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def gradient_background(size: tuple[int, int]) -> Image.Image:
    width, height = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        r = int(10 + (6 - 10) * t)
        g = int(11 + (8 - 11) * t)
        b = int(16 + (12 - 16) * t)
        for x in range(width):
            dx = (x - width / 2) / (width / 2)
            lift = max(0.0, 1.0 - math.sqrt(dx * dx + (t * 1.15) ** 2))
            # Warm orange lift near the top center (brand), not generic blue.
            px[x, y] = (
                min(255, int(r + 42 * lift)),
                min(255, int(g + 22 * lift)),
                min(255, int(b + 12 * lift)),
            )
    return img


def round_corners(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, im.size[0], im.size[1]), radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [text]


def compose(
    raw_path: Path,
    out_path: Path,
    canvas_size: tuple[int, int],
    title: str,
    subtitle: str,
    landscape: bool = False,
) -> None:
    canvas_w, canvas_h = canvas_size
    bg = gradient_background(canvas_size).convert("RGBA")
    draw = ImageDraw.Draw(bg)

    title_size = 78 if landscape else 96
    subtitle_size = 36 if landscape else 40
    title_font = load_font(title_size, bold=True)
    subtitle_font = load_font(subtitle_size, bold=False)

    max_text_width = int(canvas_w * (0.78 if landscape else 0.86))
    title_lines = wrap_text(draw, title, title_font, max_text_width)
    subtitle_lines = wrap_text(draw, subtitle, subtitle_font, max_text_width)

    # Fixed headline band so UI always gets a large stage.
    text_band = int(canvas_h * (0.22 if landscape else 0.18))
    text_top = int(canvas_h * (0.045 if landscape else 0.05))
    y = text_top
    for line in title_lines:
        w = draw.textlength(line, font=title_font)
        draw.text(((canvas_w - w) / 2, y), line, fill=(250, 251, 252, 255), font=title_font)
        y += int(title_size * 1.08)
    # Brand accent underline under the title.
    accent_w = min(int(canvas_w * 0.18), 160)
    accent_y = y + 6
    draw.rounded_rectangle(
        ((canvas_w - accent_w) / 2, accent_y, (canvas_w + accent_w) / 2, accent_y + 6),
        radius=3,
        fill=ACCENT,
    )
    y = accent_y + 18
    for line in subtitle_lines:
        w = draw.textlength(line, font=subtitle_font)
        draw.text(((canvas_w - w) / 2, y), line, fill=(180, 188, 200, 255), font=subtitle_font)
        y += int(subtitle_size * 1.22)

    # Full-bleed-ish device stage under the copy — no fake double bezel.
    stage_top = max(y + 28, text_band)
    stage_bottom = canvas_h - (40 if landscape else 56)
    stage_height = max(200, stage_bottom - stage_top)
    stage_width = int(canvas_w * (0.72 if landscape else 0.88))

    raw = Image.open(raw_path).convert("RGBA")
    scale = min(stage_width / raw.width, stage_height / raw.height)
    phone_w = max(1, int(raw.width * scale))
    phone_h = max(1, int(raw.height * scale))
    phone = raw.resize((phone_w, phone_h), Image.Resampling.LANCZOS)

    radius = 48 if landscape else 72
    phone_rounded = round_corners(phone, radius)

    # Soft shadow only — keep the UI edge-to-edge inside the rounded rect.
    shadow = Image.new("RGBA", (phone_w + 40, phone_h + 40), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (12, 18, phone_w + 28, phone_h + 34),
        radius=radius + 8,
        fill=(0, 0, 0, 160),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))

    dx = (canvas_w - phone_w) // 2
    dy = stage_top + max(0, (stage_height - phone_h) // 2)
    bg.alpha_composite(shadow, (dx - 20, dy - 20))
    bg.alpha_composite(phone_rounded, (dx, dy))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out_path, format="PNG", optimize=True)
    print(f"wrote {out_path}")


def infer_scene(name: str) -> str | None:
    stem = Path(name).stem.lower()
    # Prefer longer scene keys first so "threads" wins over "thread".
    for scene in sorted(SCENE_COPY, key=len, reverse=True):
        if scene in stem:
            return scene
    return None


def infer_preset(path: Path) -> str | None:
    joined = str(path).lower()
    for key in SIZE_PRESETS:
        if key in joined:
            return key
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--preset", choices=sorted(SIZE_PRESETS), default=None)
    parser.add_argument(
        "--numbered",
        action="store_true",
        help="Write 01-scene.png style names in SCENE_ORDER for ASC upload folders",
    )
    args = parser.parse_args()

    if args.preset is None and infer_preset(args.raw_dir) is None and infer_preset(args.out_dir) is None:
        raise SystemExit("pass --preset explicitly (iphone-6.5, iphone-6.9, or ipad-13)")

    raws = sorted(args.raw_dir.rglob("*.png"))
    if not raws:
        raise SystemExit(f"no PNGs under {args.raw_dir}")

    by_scene: dict[str, Path] = {}
    for raw in raws:
        scene = infer_scene(raw.name)
        if scene is None:
            continue
        by_scene[scene] = raw

    order = [scene for scene in SCENE_ORDER if scene in by_scene]
    if not order:
        raise SystemExit(f"no known scenes under {args.raw_dir}")

    for index, scene in enumerate(order, start=1):
        raw = by_scene[scene]
        title, subtitle = SCENE_COPY[scene]
        preset = args.preset or infer_preset(raw) or infer_preset(args.out_dir) or infer_preset(args.raw_dir)
        if preset is None:
            raise SystemExit("could not infer preset; pass --preset")
        canvas = SIZE_PRESETS[preset]
        landscape = canvas[0] > canvas[1]
        name = f"{index:02d}-{scene}.png" if args.numbered else f"{scene}.png"
        out = args.out_dir / name
        compose(raw, out, canvas, title, subtitle, landscape=landscape)


if __name__ == "__main__":
    main()
