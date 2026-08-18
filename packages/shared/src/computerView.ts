/**
 * Display listing and viewer→screen geometry for Computer View.
 *
 * Desktop MCP list_displays formats differ by platform:
 * - macOS: `[0] 2880x1800 at (0, 0)`
 * - Windows/Linux: `[0] Built-in Display  2880x1800  at (0,0)  PRIMARY`
 */

export type ComputerViewDisplayInfo = {
  readonly index: number;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly primary: boolean;
};

const DISPLAY_LINE =
  /^\[(\d+)\](?:\s+(.+?))?\s+(\d+)x(\d+)\s+at\s+\((-?\d+),\s*(-?\d+)\)(?:\s+(PRIMARY))?/i;

export function parseComputerViewDisplays(text: string): ReadonlyArray<ComputerViewDisplayInfo> {
  const displays: Array<ComputerViewDisplayInfo> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = DISPLAY_LINE.exec(line);
    if (!match) continue;
    const index = Number(match[1]);
    const width = Number(match[3]);
    const height = Number(match[4]);
    const x = Number(match[5]);
    const y = Number(match[6]);
    if (![index, width, height, x, y].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0 || index < 0) continue;
    const name = match[2]?.trim();
    displays.push({
      index,
      label: name && name.length > 0 ? name : `Display ${index}`,
      width,
      height,
      x,
      y,
      primary: Boolean(match[7]),
    });
  }
  return displays;
}

export function selectComputerViewDisplay(
  displays: ReadonlyArray<ComputerViewDisplayInfo>,
  preferredIndex: number | undefined,
): ComputerViewDisplayInfo | null {
  if (displays.length === 0) return null;
  if (preferredIndex !== undefined) {
    const preferred = displays.find((display) => display.index === preferredIndex);
    if (preferred) return preferred;
  }
  return displays.find((display) => display.primary) ?? displays[0] ?? null;
}

/**
 * Map a point inside a rendered (object-fit: contain) image to absolute screen
 * coordinates on the host display.
 */
export function mapViewerPointToScreen(input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly elementLeft: number;
  readonly elementTop: number;
  readonly elementWidth: number;
  readonly elementHeight: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
}): { readonly x: number; readonly y: number } | null {
  if (
    input.elementWidth <= 0 ||
    input.elementHeight <= 0 ||
    input.imageWidth <= 0 ||
    input.imageHeight <= 0 ||
    input.screenWidth <= 0 ||
    input.screenHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    input.elementWidth / input.imageWidth,
    input.elementHeight / input.imageHeight,
  );
  const drawnWidth = input.imageWidth * scale;
  const drawnHeight = input.imageHeight * scale;
  const offsetX = (input.elementWidth - drawnWidth) / 2;
  const offsetY = (input.elementHeight - drawnHeight) / 2;

  const localX = input.clientX - input.elementLeft - offsetX;
  const localY = input.clientY - input.elementTop - offsetY;
  if (localX < 0 || localY < 0 || localX > drawnWidth || localY > drawnHeight) {
    return null;
  }

  const imageX = localX / scale;
  const imageY = localY / scale;
  return {
    x: input.screenX + (imageX / input.imageWidth) * input.screenWidth,
    y: input.screenY + (imageY / input.imageHeight) * input.screenHeight,
  };
}

/** Read width/height from a PNG IHDR chunk. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/**
 * Read dimensions from a baseline JPEG (SOF0/SOF2). Returns null when the
 * stream is truncated or not a JPEG.
 */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return null;
    // Soften markers without a length.
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 3 >= bytes.length) return null;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    // SOF0 / SOF1 / SOF2
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (offset + 8 >= bytes.length) return null;
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

export function readImageSize(
  bytes: Uint8Array,
  mimeType: "image/jpeg" | "image/png",
): { width: number; height: number } | null {
  return mimeType === "image/jpeg" ? readJpegSize(bytes) : readPngSize(bytes);
}
