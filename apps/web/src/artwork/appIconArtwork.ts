import mark from "../../../../assets/munim/app-icon.icon/Assets/text.svg?raw";
import munimIcon from "../../../../assets/munim/munim-macos-1024.png";
import {
  sampleSkyRamp,
  skyHidesStars,
  TILE_STARS,
  skyIconOverlayImage,
  skyIconRamp,
  type SkyPhase,
  type SkyWeather,
} from "./skyArtwork";
import blueprint from "../../../../assets/dev/app-icon.icon/Assets/background.svg?raw";
import night from "../../../../assets/munim/app-icon.icon/Assets/background.svg?raw";
import leftCloud from "../../../../assets/munim/app-icon.icon/Assets/cloud-lower-left.svg?raw";
import rightCloud from "../../../../assets/munim/app-icon.icon/Assets/cloud-upper-right.svg?raw";

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
export const NIGHT_ICON_BACKGROUND = svgUrl(night);
export const BLUEPRINT_ICON_BACKGROUND = svgUrl(blueprint);

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Could not render app icon artwork")), {
      once: true,
    });
    image.src = source;
  });
}

/** NativeImage needs a raster image. Keep the actual MT vector mark, never regenerate it. */
export async function renderArtworkAppIcon(background: string): Promise<string> {
  const images = await Promise.all(
    [
      background,
      svgUrl(mark),
      ...(background === NIGHT_ICON_BACKGROUND ? [svgUrl(leftCloud), svgUrl(rightCloud)] : []),
    ].map(loadImage),
  );
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.beginPath();
  context.roundRect(32, 32, 448, 448, 100);
  context.clip();
  context.fillStyle = "#17152e";
  context.fillRect(32, 32, 448, 448);
  const art = images[0]!;
  const scale = Math.max(448 / art.naturalWidth, 448 / art.naturalHeight);
  context.drawImage(
    art,
    256 - (art.naturalWidth * scale) / 2,
    256 - (art.naturalHeight * scale) / 2,
    art.naturalWidth * scale,
    art.naturalHeight * scale,
  );
  images.slice(2).forEach((cloud) => context.drawImage(cloud, 32, 32, 448, 448));
  context.drawImage(images[1]!, 32, 32, 448, 448);
  context.strokeStyle = "rgba(255,255,255,.2)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(33, 33, 446, 446, 99);
  context.stroke();
  return canvas.toDataURL("image/png");
}

/** Tones to substitute where the tile's stars sit, keyed by pixel index. */
function starLevels(): Map<number, number> {
  const levels = new Map<number, number>();
  for (const [starX, starY, radius, level] of TILE_STARS) {
    const reach = radius + 7;
    const tone = Math.round(level * 255);
    for (let y = starY - reach; y <= starY + reach; y++)
      for (let x = starX - reach; x <= starX + reach; x++)
        if ((x - starX) ** 2 + (y - starY) ** 2 <= reach ** 2) levels.set(y * 1024 + x, tone);
  }
  return levels;
}

const EDGE_BAND = 10;
const EDGE_FEATHER = 7;

/** How far a point sits inside the tile's squircle, in its own 1024 units. */
function edgeInset(x: number, y: number): number {
  const fromCenterX = Math.abs(x - 511.5) - 222;
  const fromCenterY = Math.abs(y - 511.5) - 222;
  const outside = Math.hypot(Math.max(fromCenterX, 0), Math.max(fromCenterY, 0)) - 190;
  return -outside;
}

/** 256-entry lookup from the tile's own tones to the scene's palette. */
function rampLookup(ramp: readonly string[]): Uint8ClampedArray {
  const table = new Uint8ClampedArray(768);
  for (let level = 0; level < 256; level++) {
    const color = sampleSkyRamp(ramp, level / 255);
    table[level * 3] = Number.parseInt(color.slice(1, 3), 16);
    table[level * 3 + 1] = Number.parseInt(color.slice(3, 5), 16);
    table[level * 3 + 2] = Number.parseInt(color.slice(5, 7), 16);
  }
  return table;
}

/**
 * A sky icon is the shipped MT tile itself, repainted in that scene's colours
 * and given its weather. Every tone maps through the scene palette, so the
 * artwork, its gloss and the mark all stay exactly as they ship.
 */
export async function renderSkyAppIcon(phase: SkyPhase, weather: SkyWeather): Promise<string> {
  const overlaySource = skyIconOverlayImage(phase, weather);
  const [tile, overlay] = await Promise.all([
    loadImage(munimIcon),
    overlaySource === "" ? Promise.resolve(null) : loadImage(overlaySource),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(tile, 0, 0, 1024, 1024);
  const ramp = skyIconRamp(phase, weather);
  if (ramp === null) {
    if (overlay) context.drawImage(overlay, 0, 0, 1024, 1024);
    return canvas.toDataURL("image/png");
  }
  const frame = context.getImageData(0, 0, 1024, 1024);
  const table = rampLookup(ramp);
  // Daylight and overcast skies show no stars: the tile's specks take the tone
  // of what they sit on, so they vanish into the repainted sky.
  const hidden = skyHidesStars(phase, weather) ? starLevels() : null;
  for (let pixel = 0; pixel < frame.data.length; pixel += 4) {
    if (frame.data[pixel + 3] === 0) continue;
    const red = frame.data[pixel]!;
    const green = frame.data[pixel + 1]!;
    const blue = frame.data[pixel + 2]!;
    const painted = hidden?.get(pixel >> 2);
    const level = painted ?? (red * 0.2126 + green * 0.7152 + blue * 0.0722) | 0;
    // The mark and its grey outline keep the tile's own pixels: repainting them
    // tints the mark and turns the outline into a coloured glow. Only the mark,
    // though — the glass edge has to repaint with the sky or it reads as a ring
    // of the old artwork drawn around the new one.
    const x = (pixel >> 2) % 1024;
    const y = (pixel >> 2) / 1024;
    if (painted === undefined && x > 218 && x < 805 && y > 245 && y < 777) {
      const highest = red > green ? (red > blue ? red : blue) : green > blue ? green : blue;
      const lowest = red < green ? (red < blue ? red : blue) : green < blue ? green : blue;
      if (level > 133 && highest > 0 && (highest - lowest) / highest < 0.16) continue;
    }
    let red2 = table[level * 3]!;
    let green2 = table[level * 3 + 1]!;
    let blue2 = table[level * 3 + 2]!;
    // The glass edge belongs to the tile, not to the weather: the outermost
    // pixels stay exactly as they ship, fading into the repaint just inside, so
    // every scene carries the edge the default icon has.
    const inset = edgeInset(x, y);
    if (inset < EDGE_BAND) {
      const hold = inset < EDGE_BAND - EDGE_FEATHER ? 1 : (EDGE_BAND - inset) / EDGE_FEATHER;
      red2 = Math.round(red2 + (red - red2) * hold);
      green2 = Math.round(green2 + (green - green2) * hold);
      blue2 = Math.round(blue2 + (blue - blue2) * hold);
    }
    frame.data[pixel] = red2;
    frame.data[pixel + 1] = green2;
    frame.data[pixel + 2] = blue2;
  }
  context.putImageData(frame, 0, 0);
  if (overlay) context.drawImage(overlay, 0, 0, 1024, 1024);
  return canvas.toDataURL("image/png");
}
