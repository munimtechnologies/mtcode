/**
 * Pure mapping between Computer View RPC inputs and desktop-MCP tool calls,
 * plus parsing of the MCP tool results those calls return. Effect-free so the
 * translation can be unit tested without spawning the native binary.
 */
import type { ComputerViewFrameEvent, ComputerViewInput } from "@t3tools/contracts";
import { readImageSize, type ComputerViewDisplayInfo } from "@t3tools/shared/computerView";

export interface DesktopMcpToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/**
 * Viewer input to desktop-MCP tool call. Scroll x/y are intentionally unused:
 * the MCP scroll tool acts at the current cursor position and takes no
 * coordinates.
 */
export function computerViewToolCall(input: ComputerViewInput): DesktopMcpToolCall {
  switch (input.type) {
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
