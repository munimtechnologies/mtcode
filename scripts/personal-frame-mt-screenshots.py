#!/usr/bin/env python3
"""Compose App Store marketing screenshots for MT Code.

Takes raw simulator captures from the mobile showcase harness and lays them
onto a dark canvas with a benefit headline + device bezel so the App Store
product page reads more intentionally than bare UI dumps.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SCENE_COPY: dict[str, tuple[str, str]] = {
    "threads": ("Your agents, in your pocket", "Live threads from every machine"),
    "thread": ("Code from anywhere", "Pick up the same session on your phone"),
    "terminal": ("Terminal that travels", "Full shell output without opening a laptop"),
    "review": ("Ship with confidence", "Read diffs and approve changes on the go"),
    "environments": ("Every machine, one tap", "Pair desktops and keep them in sync"),
}

# App Store Connect upload sizes we care about for MT Code.
SIZE_PRESETS = {
    "iphone-6.9": (1320, 2868),
    "iphone-6.5": (1284, 2778),
    "ipad-13": (2752, 2064),
}


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
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
    # Deep charcoal → near-black, with a cool blue lift near the top.
    for y in range(height):
        t = y / max(height - 1, 1)
        r = int(12 + (8 - 12) * t)
        g = int(14 + (10 - 14) * t)
        b = int(22 + (14 - 22) * t)
        # Soft radial-ish vignette from top center.
        for x in range(width):
            dx = (x - width / 2) / (width / 2)
            lift = max(0.0, 1.0 - math.sqrt(dx * dx + (t * 1.2) ** 2))
            px[x, y] = (
                min(255, int(r + 28 * lift)),
                min(255, int(g + 36 * lift)),
                min(255, int(b + 58 * lift)),
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

    title_size = 72 if landscape else 86
    subtitle_size = 34 if landscape else 38
    title_font = load_font(title_size, bold=True)
    subtitle_font = load_font(subtitle_size, bold=False)

    max_text_width = int(canvas_w * (0.72 if landscape else 0.82))
    title_lines = wrap_text(draw, title, title_font, max_text_width)
    subtitle_lines = wrap_text(draw, subtitle, subtitle_font, max_text_width)

    text_top = int(canvas_h * (0.06 if landscape else 0.055))
    y = text_top
    for line in title_lines:
        w = draw.textlength(line, font=title_font)
        draw.text(((canvas_w - w) / 2, y), line, fill=(245, 247, 250, 255), font=title_font)
        y += int(title_size * 1.12)
    y += 10
    for line in subtitle_lines:
        w = draw.textlength(line, font=subtitle_font)
        draw.text(((canvas_w - w) / 2, y), line, fill=(170, 180, 196, 255), font=subtitle_font)
        y += int(subtitle_size * 1.25)

    # Device stage under the copy.
    stage_top = y + (36 if landscape else 48)
    stage_bottom = canvas_h - (48 if landscape else 72)
    stage_height = max(200, stage_bottom - stage_top)
    stage_width = int(canvas_w * (0.62 if landscape else 0.78))

    raw = Image.open(raw_path).convert("RGBA")
    # Fit raw screenshot into the stage while preserving aspect ratio.
    scale = min(stage_width / raw.width, stage_height / raw.height)
    phone_w = max(1, int(raw.width * scale))
    phone_h = max(1, int(raw.height * scale))
    phone = raw.resize((phone_w, phone_h), Image.Resampling.LANCZOS)

    bezel = 18 if landscape else 22
    radius = 64 if landscape else 92
    device = Image.new("RGBA", (phone_w + bezel * 2, phone_h + bezel * 2), (0, 0, 0, 0))
    device_draw = ImageDraw.Draw(device)
    device_draw.rounded_rectangle(
        (0, 0, device.size[0] - 1, device.size[1] - 1),
        radius=radius,
        fill=(8, 10, 14, 255),
    )
    # Subtle outer glow.
    glow = device.filter(ImageFilter.GaussianBlur(28))
    phone_rounded = round_corners(phone, radius - bezel + 8)
    device.alpha_composite(phone_rounded, (bezel, bezel))

    dx = (canvas_w - device.size[0]) // 2
    dy = stage_top + max(0, (stage_height - device.size[1]) // 2)
    bg.alpha_composite(glow, (dx - 10, dy - 10))
    bg.alpha_composite(device, (dx, dy))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out_path, format="PNG", optimize=True)
    print(f"wrote {out_path}")


def infer_scene(name: str) -> str | None:
    stem = Path(name).stem.lower()
    for scene in SCENE_COPY:
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
    args = parser.parse_args()

    raws = sorted(args.raw_dir.rglob("*.png"))
    if not raws:
        raise SystemExit(f"no PNGs under {args.raw_dir}")

    for raw in raws:
        scene = infer_scene(raw.name)
        if scene is None:
            continue
        title, subtitle = SCENE_COPY[scene]
        preset = args.preset or infer_preset(raw) or "iphone-6.9"
        canvas = SIZE_PRESETS[preset]
        landscape = canvas[0] > canvas[1]
        out = args.out_dir / f"{scene}.png"
        compose(raw, out, canvas, title, subtitle, landscape=landscape)


if __name__ == "__main__":
    main()
