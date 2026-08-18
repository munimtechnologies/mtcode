/**
 * Maps browser pointer/keyboard/wheel events onto ComputerViewInput payloads
 * for the remote machine. Coordinates entering these helpers are already in
 * remote screen space (see mapViewerPointToScreen in @t3tools/shared).
 */
import type { ComputerViewInput } from "@t3tools/contracts";

/** Pointer movement below this many remote-screen pixels stays a click. */
export const COMPUTER_VIEW_DRAG_THRESHOLD_PX = 5;

const WHEEL_PIXELS_PER_SCROLL_LINE = 40;
const MAX_SCROLL_AMOUNT = 20;

/** DOM `KeyboardEvent.key` names to the desktop MCP's named-key vocabulary. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Enter: "return",
  Tab: "tab",
  Escape: "escape",
  Backspace: "backspace",
  // "delete" means backspace on the macOS helper, so use the explicit name.
  Delete: "forwarddelete",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

interface KeyboardEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

function eventModifiers(
  event: KeyboardEventLike,
  options?: { readonly includeShift?: boolean },
): Array<"cmd" | "shift" | "alt" | "ctrl"> {
  const modifiers: Array<"cmd" | "shift" | "alt" | "ctrl"> = [];
  if (event.metaKey) modifiers.push("cmd");
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey && options?.includeShift !== false) modifiers.push("shift");
  return modifiers;
}

/**
 * Keydown to remote input. Plain printable characters go through `type` so
 * the remote types the exact character (shift, layout, and symbols included);
 * chords and named keys go through `key`. Bare modifier presses map to null.
 */
export function mapKeyboardEventToComputerViewInput(
  event: KeyboardEventLike,
): ComputerViewInput | null {
  const named =
    NAMED_KEYS[event.key] ?? (FUNCTION_KEY.test(event.key) ? event.key.toLowerCase() : undefined);
  if (named !== undefined) {
    const modifiers = eventModifiers(event);
    return {
      type: "key",
      key: named,
      ...(modifiers.length === 0 ? {} : { modifiers }),
    };
  }
  const isPrintable = event.key.length === 1 || event.key === " ";
  if (!isPrintable) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) {
    // Chords target the key itself; the character already encodes shift, so
    // it is only forwarded when it does not change the character (letters).
    const lowered = event.key.toLowerCase();
    const includeShift = lowered !== event.key.toUpperCase() || event.key === " ";
    return {
      type: "key",
      key: event.key === " " ? "space" : lowered,
      modifiers: eventModifiers(event, { includeShift }),
    };
  }
  return { type: "type", text: event.key };
}

/**
 * One wheel event to one scroll input on the dominant axis, or null for a
 * zero-delta event.
 */
export function mapWheelToComputerViewInput(input: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly x: number;
  readonly y: number;
}): ComputerViewInput | null {
  const dominantY = Math.abs(input.deltaY) >= Math.abs(input.deltaX);
  const delta = dominantY ? input.deltaY : input.deltaX;
  if (delta === 0) return null;
  const direction = dominantY ? (delta > 0 ? "down" : "up") : delta > 0 ? "right" : "left";
  const amount = Math.min(
    MAX_SCROLL_AMOUNT,
    Math.max(1, Math.round(Math.abs(delta) / WHEEL_PIXELS_PER_SCROLL_LINE)),
  );
  return { type: "scroll", x: input.x, y: input.y, direction, amount };
}

/**
 * A completed pointer gesture: a drag when the pointer moved past the
 * threshold, otherwise a click at the release point. Secondary-button
 * gestures always resolve to a right click (remote right-drag is not
 * supported by the input path).
 */
export function classifyPointerGesture(input: {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly button: "left" | "right";
  readonly clickCount: number;
  readonly thresholdPx?: number;
}): ComputerViewInput {
  const threshold = input.thresholdPx ?? COMPUTER_VIEW_DRAG_THRESHOLD_PX;
  const movedPx = Math.hypot(input.to.x - input.from.x, input.to.y - input.from.y);
  if (input.button === "left" && movedPx > threshold) {
    return {
      type: "drag",
      fromX: input.from.x,
      fromY: input.from.y,
      toX: input.to.x,
      toY: input.to.y,
    };
  }
  const clickCount = Math.min(3, Math.max(1, input.clickCount));
  return {
    type: "click",
    x: input.to.x,
    y: input.to.y,
    ...(input.button === "right" ? { button: "right" as const } : {}),
    ...(clickCount === 1 ? {} : { clickCount }),
  };
}

/** Data URL for rendering a streamed frame in an <img>. */
export function computerViewFrameDataUrl(frame: {
  readonly mimeType: string;
  readonly data: string;
}): string {
  return `data:${frame.mimeType};base64,${frame.data}`;
}
