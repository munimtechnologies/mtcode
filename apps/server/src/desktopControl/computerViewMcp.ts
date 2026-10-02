/**
 * Pure mapping between Computer View RPC inputs and desktop-MCP tool calls,
 * plus parsing of the MCP tool results those calls return. Effect-free so the
 * translation can be unit tested without spawning the native binary.
 */
import {
  COMPUTER_VIEW_MIN_INTERVAL_MS,
  type ComputerViewCursorEvent,
  type ComputerViewFrameEvent,
  type ComputerViewInput,
  type ComputerViewQuality,
} from "@t3tools/contracts";
import { readImageSize, type ComputerViewDisplayInfo } from "@t3tools/shared/computerView";

export interface DesktopMcpToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** JPEG quality per viewer setting; "lossless" switches the encoding to PNG. */
const JPEG_QUALITY: Readonly<Record<Exclude<ComputerViewQuality, "lossless">, number>> = {
  low: 35,
  standard: 55,
  high: 85,
};

/** Longest a live capture call waits for the screen to change before answering. */
export const COMPUTER_VIEW_LIVE_WAIT_MS = 500;

/**
 * `screenshot` arguments for one frame. JPEG keeps a live stream cheap. Hosts
 * older than munim-computer-use 0.6.0 differ: the macOS one only produces PNG
 * and ignores `format` and `quality`, and anything before 0.5.1 ignores
 * `quality`.
 *
 * `live` asks the host for its live capture (0.6.0+ on macOS and Windows):
 * the host keeps a capture stream open and, given `after`, waits until the
 * screen changes past that frame. Older hosts and Linux ignore it and answer
 * with an ordinary screenshot.
 */
export function computerViewCaptureArguments(input: {
  readonly display: number;
  readonly maxWidth: number;
  readonly quality?: ComputerViewQuality | undefined;
  /** Ask for the pointer too (munim-computer-use 0.5.2+ on Windows). */
  readonly cursor?: boolean | undefined;
  readonly live?: { readonly after: number | null; readonly waitMs: number } | undefined;
}): Record<string, unknown> {
  const quality = input.quality ?? "standard";
  const cursor = input.cursor === true ? { cursor: true } : {};
  const live =
    input.live === undefined
      ? {}
      : {
          live: true,
          wait_ms: input.live.waitMs,
          ...(input.live.after === null ? {} : { after: input.live.after }),
        };
  if (quality === "lossless") {
    return { display: input.display, max_width: input.maxWidth, format: "png", ...cursor, ...live };
  }
  return {
    display: input.display,
    max_width: input.maxWidth,
    format: "jpeg",
    quality: JPEG_QUALITY[quality],
    ...cursor,
    ...live,
  };
}

/** Where a live capture stands: its newest frame, and whether this result carries it. */
export interface ComputerViewLiveState {
  readonly seq: number;
  readonly changed: boolean;
}

/**
 * The host's `live: {json}` line. Null when the host took an ordinary
 * screenshot instead, because it is older than 0.6.0 or has no live capture
 * for this display.
 */
export function toolResultLive(result: McpToolResult): ComputerViewLiveState | null {
  for (const item of contentItems(result)) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    if (!item.text.startsWith("live: ")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text.slice("live: ".length));
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq)) return null;
    return { seq: value.seq, changed: value.changed === true };
  }
  return null;
}

/** The pointer a capture reported, as the host's `cursor: {json}` text line. */
export interface ComputerViewHostCursor {
  readonly id: string;
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly width: number;
  readonly height: number;
  readonly image: string | null;
}

/**
 * The cursor event to send for this capture, or null when the pointer has not
 * changed shape, visibility or position since the last one. Each shape's image
 * travels once per stream: `sentImages` holds the ids the viewer already has.
 */
export function computerViewCursorEvent(
  cursor: ComputerViewHostCursor,
  previous: ComputerViewHostCursor | null,
  sentImages: ReadonlySet<string>,
): ComputerViewCursorEvent | null {
  if (
    previous !== null &&
    previous.id === cursor.id &&
    previous.visible === cursor.visible &&
    previous.x === cursor.x &&
    previous.y === cursor.y
  ) {
    return null;
  }
  return {
    type: "cursor",
    id: cursor.id,
    visible: cursor.visible,
    x: cursor.x,
    y: cursor.y,
    hotspotX: cursor.hotspotX,
    hotspotY: cursor.hotspotY,
    width: cursor.width,
    height: cursor.height,
    ...(cursor.image !== null && !sentImages.has(cursor.id) ? { image: cursor.image } : {}),
  };
}

export function toolResultCursor(result: McpToolResult): ComputerViewHostCursor | null {
  for (const item of contentItems(result)) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    if (!item.text.startsWith("cursor: ")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text.slice("cursor: ".length));
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    const number = (key: string) =>
      typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : 0;
    if (typeof value.id !== "string") return null;
    return {
      id: value.id,
      visible: value.visible === true,
      x: number("x"),
      y: number("y"),
      hotspotX: Math.round(number("hotspot_x")),
      hotspotY: Math.round(number("hotspot_y")),
      width: Math.round(number("width")),
      height: Math.round(number("height")),
      image: typeof value.png === "string" && value.png.length > 0 ? value.png : null,
    };
  }
  return null;
}

/**
 * Gap between captures for a requested frame rate. Without one the host keeps
 * its default cadence; with one it never captures faster than 30 frames a
 * second, whatever the viewer asks.
 */
export function computerViewCaptureIntervalMs(frameRate: number | undefined): number {
  if (frameRate === undefined || !Number.isFinite(frameRate) || frameRate <= 0) {
    return COMPUTER_VIEW_MIN_INTERVAL_MS;
  }
  return Math.max(Math.round(1000 / 30), Math.round(1000 / frameRate));
}

/**
 * Viewer input to desktop-MCP tool call. The viewer process runs the desktop
 * MCP in remote-control mode, where every one of these drives the machine's
 * real pointer and keyboard rather than being routed to a window in the
 * background -- so a plain pointer move is a `hover`, and the wheel carries the
 * coordinates it should act over.
 */
export function computerViewToolCall(input: ComputerViewInput): DesktopMcpToolCall {
  switch (input.type) {
    case "move":
      return { name: "hover", arguments: { x: input.x, y: input.y } };
    case "click":
      return input.button === "right"
        ? { name: "right_click", arguments: { x: input.x, y: input.y } }
        : {
            name: "click",
            arguments: {
              x: input.x,
              y: input.y,
              ...(input.clickCount === undefined ? {} : { click_count: input.clickCount }),
            },
          };
    case "drag":
      return {
        name: "drag",
        arguments: {
          from_x: input.fromX,
          from_y: input.fromY,
          to_x: input.toX,
          to_y: input.toY,
        },
      };
    case "scroll":
      return {
        name: "scroll",
        arguments: {
          direction: input.direction,
          x: input.x,
          y: input.y,
          ...(input.amount === undefined ? {} : { amount: input.amount }),
        },
      };
    case "key":
      return {
        name: "press_key",
        arguments: {
          key: input.key,
          ...(input.modifiers === undefined || input.modifiers.length === 0
            ? {}
            : { modifiers: [...input.modifiers] }),
        },
      };
    case "type":
      return { name: "type_text", arguments: { text: input.text } };
  }
}

interface McpToolContentItem {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly data?: unknown;
  readonly mimeType?: unknown;
}

export interface McpToolResult {
  readonly isError?: unknown;
  readonly content?: unknown;
}

function contentItems(result: McpToolResult): ReadonlyArray<McpToolContentItem> {
  return Array.isArray(result.content) ? (result.content as ReadonlyArray<McpToolContentItem>) : [];
}

export function toolResultIsError(result: McpToolResult): boolean {
  return result.isError === true;
}

export function toolResultText(result: McpToolResult): string {
  return contentItems(result)
    .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
    .join("\n");
}

export interface McpToolImage {
  readonly data: string;
  readonly mimeType: "image/jpeg" | "image/png";
}

export function toolResultImage(result: McpToolResult): McpToolImage | null {
  for (const item of contentItems(result)) {
    if (item.type !== "image" || typeof item.data !== "string") continue;
    if (item.mimeType !== "image/jpeg" && item.mimeType !== "image/png") continue;
    return { data: item.data, mimeType: item.mimeType };
  }
  return null;
}

/**
 * Assemble a frame event from a captured image and the display it came from.
 * Returns null when the bytes do not parse as the claimed image type, so a
 * garbled capture never reaches clients.
 */
export function buildComputerViewFrame(input: {
  readonly image: McpToolImage;
  readonly bytes: Uint8Array;
  readonly display: ComputerViewDisplayInfo;
}): ComputerViewFrameEvent | null {
  const size = readImageSize(input.bytes, input.image.mimeType);
  if (size === null) return null;
  return {
    type: "frame",
    displayIndex: input.display.index,
    mimeType: input.image.mimeType,
    data: input.image.data,
    width: size.width,
    height: size.height,
    screenX: input.display.x,
    screenY: input.display.y,
    screenWidth: input.display.width,
    screenHeight: input.display.height,
  };
}
