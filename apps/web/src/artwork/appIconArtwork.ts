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

const RIM = 24;
const SECTORS = 64;
const SKY_BELOW_RIM = 6;

/** Distance from every pixel to the tile's edge, from its own silhouette. */
function edgeDistance(pixels: Uint8ClampedArray): Float32Array {
  const distance = new Float32Array(1024 * 1024);
  for (let index = 0; index < distance.length; index++)
    distance[index] = pixels[index * 4 + 3]! >= 128 ? Infinity : 0;
  const step = (index: number, from: number, cost: number) => {
    const candidate = distance[from]! + cost;
    if (candidate < distance[index]!) distance[index] = candidate;
  };
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++) {
      const index = y * 1024 + x;
      if (distance[index] === 0) continue;
      if (x > 0) step(index, index - 1, 1);
      if (y > 0) {
        step(index, index - 1024, 1);
        if (x > 0) step(index, index - 1025, 1.414);
        if (x < 1023) step(index, index - 1023, 1.414);
      }
    }
  for (let y = 1023; y >= 0; y--)
    for (let x = 1023; x >= 0; x--) {
      const index = y * 1024 + x;
      if (distance[index] === 0) continue;
      if (x < 1023) step(index, index + 1, 1);
      if (y < 1023) {
        step(index, index + 1024, 1);
        if (x > 0) step(index, index + 1023, 1.414);
        if (x < 1023) step(index, index + 1025, 1.414);
      }
    }
  return distance;
}

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[values.length >> 1]!;
};

/**
 * The glass edge measured around the whole perimeter: for each sector and each
 * pixel of depth, how much white the tile lays over its sky, or how much it
 * darkens it. Taking medians per sector and smoothing across them keeps the
 * artwork out of it — probing a single pixel for "the sky under the rim" lands
 * on a cloud or a star and leaves a blot.
 */
function rimProfile(pixels: Uint8ClampedArray, distance: Float32Array) {
  const depths: number[][][] = Array.from({ length: SECTORS }, () =>
    Array.from({ length: RIM + 1 }, () => [] as number[]),
  );
  const skies: number[][] = Array.from({ length: SECTORS }, () => [] as number[]);
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++) {
      const index = y * 1024 + x;
      const depth = distance[index]!;
      if (depth <= 0 || depth > RIM + 16) continue;
      const pixel = index * 4;
      if (pixels[pixel + 3]! < 200) continue;
      const sector =
        Math.floor(((Math.atan2(y - 511.5, x - 511.5) + Math.PI) / (2 * Math.PI)) * SECTORS) %
        SECTORS;
      const level =
        pixels[pixel]! * 0.2126 + pixels[pixel + 1]! * 0.7152 + pixels[pixel + 2]! * 0.0722;
      if (depth <= RIM) depths[sector]![Math.floor(depth)]!.push(level);
      else if (depth >= RIM + SKY_BELOW_RIM) skies[sector]!.push(level);
    }
  const raw = skies.map(median);
  const sky = raw.map((_, sector) =>
    median([-2, -1, 0, 1, 2].map((offset) => raw[(sector + offset + SECTORS) % SECTORS]!)),
  );
  const alpha = depths.map((sectorDepths, sector) =>
    sectorDepths.map((values) => {
      const level = values.length ? median(values) : sky[sector]!;
      const reference = sky[sector]!;
      return level >= reference
        ? (level - reference) / Math.max(1, 255 - reference)
        : -(reference - level) / Math.max(1, reference);
    }),
  );
  const smooth = alpha.map((_, sector) =>
    alpha[sector]!.map(
      (_value, depth) =>
        [-2, -1, 0, 1, 2].reduce(
          (total, offset) => total + alpha[(sector + offset + SECTORS) % SECTORS]![depth]!,
          0,
        ) / 5,
    ),
  );
  return { alpha: smooth, sky };
}

// The tile never changes, so its edge is measured once.
let tileDistance: Float32Array | null = null;
let tileRim: ReturnType<typeof rimProfile> | null = null;

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
  // Measured from the tile as it shipped; the loop overwrites as it goes.
  const origin = new Uint8ClampedArray(frame.data);
  const distance = (tileDistance ??= edgeDistance(origin));
  const rim = (tileRim ??= rimProfile(origin, distance));
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
    // The glass edge ships with the tile and every icon wears the same one, but
    // it has to end up in the scene's colours without eating the art beneath
    // it. So the sheen is lifted off, whatever it covered is repainted, and the
    // sheen goes back on: clouds keep running to the edge, and the rim traces
    // the shipped one's brightness in whatever colour the sky is.
    const depth = distance[pixel >> 2]!;
    if (depth > 0 && depth <= RIM) {
      const position = ((Math.atan2(y - 511.5, x - 511.5) + Math.PI) / (2 * Math.PI)) * SECTORS;
      const lower = Math.floor(position) % SECTORS;
      const upper = (lower + 1) % SECTORS;
      const across = position - Math.floor(position);
      const shallow = Math.floor(depth);
      const deeper = Math.min(RIM, shallow + 1);
      const into = depth - shallow;
      const sheen =
        (rim.alpha[lower]![shallow]! * (1 - into) + rim.alpha[lower]![deeper]! * into) *
          (1 - across) +
        (rim.alpha[upper]![shallow]! * (1 - into) + rim.alpha[upper]![deeper]! * into) * across;
      if (sheen > 0) {
        const lit = Math.min(sheen, 0.92);
        const beneath = Math.max(0, Math.min(255, Math.round((level - 255 * lit) / (1 - lit)))) * 3;
        red2 = Math.round(table[beneath]! + (255 - table[beneath]!) * lit);
        green2 = Math.round(table[beneath + 1]! + (255 - table[beneath + 1]!) * lit);
        blue2 = Math.round(table[beneath + 2]! + (255 - table[beneath + 2]!) * lit);
      } else if (sheen < 0) {
        const dimmed = Math.max(0.25, 1 + sheen);
        const beneath = Math.max(0, Math.min(255, Math.round(level / dimmed))) * 3;
        red2 = Math.round(table[beneath]! * dimmed);
        green2 = Math.round(table[beneath + 1]! * dimmed);
        blue2 = Math.round(table[beneath + 2]! * dimmed);
      }
    }
    frame.data[pixel] = red2;
    frame.data[pixel + 1] = green2;
    frame.data[pixel + 2] = blue2;
  }
  context.putImageData(frame, 0, 0);
  if (overlay) context.drawImage(overlay, 0, 0, 1024, 1024);
  return canvas.toDataURL("image/png");
}
