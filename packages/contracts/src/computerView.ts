import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import * as Schema from "effect/Schema";

/**
 * Frame width when the viewer has not said how big it is drawing. Viewers ask
 * for their own rendered size (times the device pixel ratio) so the picture is
 * not an upscaled 960px thumbnail on a large window.
 */
export const COMPUTER_VIEW_DEFAULT_MAX_WIDTH = 1280;
/** Upper bound on a viewer's request: past this the host spends more time encoding than the link saves. */
export const COMPUTER_VIEW_MAX_WIDTH_LIMIT = 2560;
/**
 * Floor on the gap between captures. Unchanged frames are dropped before they
 * reach the wire, so a still screen costs nothing at this cadence while a
 * moving one arrives at roughly 8 frames a second.
 */
export const COMPUTER_VIEW_MIN_INTERVAL_MS = 120;

export const ComputerViewDisplay = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  label: TrimmedNonEmptyString,
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
  x: Schema.Int,
  y: Schema.Int,
  primary: Schema.Boolean,
});
export type ComputerViewDisplay = typeof ComputerViewDisplay.Type;

export const ComputerViewStreamInput = Schema.Struct({
  display: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  maxWidth: Schema.optional(
    Schema.Int.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(COMPUTER_VIEW_MAX_WIDTH_LIMIT),
    ),
  ),
});
export type ComputerViewStreamInput = typeof ComputerViewStreamInput.Type;

export const ComputerViewReadyEvent = Schema.Struct({
  type: Schema.Literal("ready"),
  displays: Schema.Array(ComputerViewDisplay),
  selectedDisplay: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ComputerViewReadyEvent = typeof ComputerViewReadyEvent.Type;

export const ComputerViewFrameEvent = Schema.Struct({
  type: Schema.Literal("frame"),
  displayIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mimeType: Schema.Literals(["image/jpeg", "image/png"]),
  /** Base64-encoded image bytes. */
  data: Schema.String,
  /** Pixel size of the streamed image (after maxWidth downscale). */
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
  /** Native display geometry used to map viewer clicks back to the screen. */
  screenX: Schema.Int,
  screenY: Schema.Int,
  screenWidth: Schema.Int.check(Schema.isGreaterThan(0)),
  screenHeight: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type ComputerViewFrameEvent = typeof ComputerViewFrameEvent.Type;

export const ComputerViewStatusEvent = Schema.Struct({
  type: Schema.Literal("status"),
  message: Schema.String,
});
export type ComputerViewStatusEvent = typeof ComputerViewStatusEvent.Type;

export const ComputerViewStreamEvent = Schema.Union([
  ComputerViewReadyEvent,
  ComputerViewFrameEvent,
  ComputerViewStatusEvent,
]);
export type ComputerViewStreamEvent = typeof ComputerViewStreamEvent.Type;

export const ComputerViewPointerButton = Schema.Literals(["left", "right"]);
export type ComputerViewPointerButton = typeof ComputerViewPointerButton.Type;

export const ComputerViewClickInput = Schema.Struct({
  type: Schema.Literal("click"),
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optionalKey(ComputerViewPointerButton),
  clickCount: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))),
});
export type ComputerViewClickInput = typeof ComputerViewClickInput.Type;

export const ComputerViewDragInput = Schema.Struct({
  type: Schema.Literal("drag"),
  fromX: Schema.Number,
  fromY: Schema.Number,
  toX: Schema.Number,
  toY: Schema.Number,
});
export type ComputerViewDragInput = typeof ComputerViewDragInput.Type;

export const ComputerViewScrollInput = Schema.Struct({
  type: Schema.Literal("scroll"),
  x: Schema.Number,
  y: Schema.Number,
  direction: Schema.Literals(["up", "down", "left", "right"]),
  amount: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type ComputerViewScrollInput = typeof ComputerViewScrollInput.Type;

export const ComputerViewKeyInput = Schema.Struct({
  type: Schema.Literal("key"),
  key: TrimmedNonEmptyString,
  modifiers: Schema.optionalKey(
    Schema.Array(Schema.Literals(["cmd", "shift", "alt", "ctrl", "fn"])),
  ),
});
export type ComputerViewKeyInput = typeof ComputerViewKeyInput.Type;

export const ComputerViewTypeInput = Schema.Struct({
  type: Schema.Literal("type"),
  text: Schema.String.check(Schema.isMaxLength(4_000)),
});
export type ComputerViewTypeInput = typeof ComputerViewTypeInput.Type;

export const ComputerViewInput = Schema.Union([
  ComputerViewClickInput,
  ComputerViewDragInput,
  ComputerViewScrollInput,
  ComputerViewKeyInput,
  ComputerViewTypeInput,
]);
export type ComputerViewInput = typeof ComputerViewInput.Type;

export const ComputerViewErrorCode = Schema.Literals([
  "unavailable",
  "permission",
  "capture_failed",
  "input_failed",
  "invalid_display",
]);
export type ComputerViewErrorCode = typeof ComputerViewErrorCode.Type;

export class ComputerViewError extends Schema.TaggedErrorClass<ComputerViewError>()(
  "ComputerViewError",
  {
    code: ComputerViewErrorCode,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
