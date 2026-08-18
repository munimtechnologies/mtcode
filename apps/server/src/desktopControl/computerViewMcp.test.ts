import { assert, describe, it } from "@effect/vitest";

import {
  buildComputerViewFrame,
  computerViewToolCall,
  toolResultImage,
  toolResultIsError,
  toolResultText,
} from "./computerViewMcp.ts";

describe("computerViewToolCall", () => {
  it("maps left clicks with a click count", () => {
    assert.deepEqual(computerViewToolCall({ type: "click", x: 10, y: 20, clickCount: 2 }), {
      name: "click",
      arguments: { x: 10, y: 20, click_count: 2 },
    });
  });

  it("maps right clicks to the context-menu tool", () => {
    assert.deepEqual(computerViewToolCall({ type: "click", x: 5, y: 6, button: "right" }), {
      name: "right_click",
      arguments: { x: 5, y: 6 },
    });
  });

  it("maps drags to coordinate endpoints", () => {
    assert.deepEqual(computerViewToolCall({ type: "drag", fromX: 1, fromY: 2, toX: 3, toY: 4 }), {
      name: "drag",
      arguments: { from_x: 1, from_y: 2, to_x: 3, to_y: 4 },
    });
  });

  it("maps scrolls without coordinates (the tool scrolls at the cursor)", () => {
    assert.deepEqual(
      computerViewToolCall({ type: "scroll", x: 100, y: 100, direction: "down", amount: 3 }),
      { name: "scroll", arguments: { direction: "down", amount: 3 } },
    );
  });

  it("maps keys with modifiers and drops empty modifier lists", () => {
    assert.deepEqual(computerViewToolCall({ type: "key", key: "s", modifiers: ["cmd", "shift"] }), {
      name: "press_key",
      arguments: { key: "s", modifiers: ["cmd", "shift"] },
    });
    assert.deepEqual(computerViewToolCall({ type: "key", key: "return", modifiers: [] }), {
      name: "press_key",
      arguments: { key: "return" },
    });
  });

  it("maps typed text", () => {
    assert.deepEqual(computerViewToolCall({ type: "type", text: "hello" }), {
      name: "type_text",
      arguments: { text: "hello" },
    });
  });
});

describe("tool result parsing", () => {
  it("joins text items and flags errors", () => {
    const result = {
      isError: true,
      content: [
        { type: "text", text: "line one" },
        { type: "image", data: "zzz", mimeType: "image/png" },
        { type: "text", text: "line two" },
      ],
    };
    assert.equal(toolResultIsError(result), true);
    assert.equal(toolResultText(result), "line one\nline two");
  });

  it("extracts the first image with a known mime type", () => {
    const result = {
      isError: false,
      content: [
        { type: "image", data: "webp-bytes", mimeType: "image/webp" },
        { type: "image", data: "png-bytes", mimeType: "image/png" },
      ],
    };
    assert.deepEqual(toolResultImage(result), { data: "png-bytes", mimeType: "image/png" });
  });

  it("returns null when a result carries no image", () => {
    assert.equal(toolResultImage({ content: [{ type: "text", text: "nope" }] }), null);
    assert.equal(toolResultImage({}), null);
  });
});

describe("buildComputerViewFrame", () => {
  const display = {
    index: 1,
    label: "Display 1",
    width: 2880,
    height: 1800,
    x: 100,
    y: -50,
    primary: true,
  };

  it("reads the streamed size from PNG bytes and carries display geometry", () => {
    // Minimal PNG header: signature + IHDR length/type + 640x360 dimensions.
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 640);
    view.setUint32(20, 360);
    const frame = buildComputerViewFrame({
      image: { data: "unused-by-size-parsing", mimeType: "image/png" },
      bytes,
      display,
    });
    assert.deepEqual(frame, {
      type: "frame",
      displayIndex: 1,
      mimeType: "image/png",
      data: "unused-by-size-parsing",
      width: 640,
      height: 360,
      screenX: 100,
      screenY: -50,
      screenWidth: 2880,
      screenHeight: 1800,
    });
  });

  it("rejects bytes that do not parse as the claimed image type", () => {
    const frame = buildComputerViewFrame({
      image: { data: "zz", mimeType: "image/jpeg" },
      bytes: new Uint8Array([1, 2, 3, 4]),
      display,
    });
    assert.equal(frame, null);
  });
});
