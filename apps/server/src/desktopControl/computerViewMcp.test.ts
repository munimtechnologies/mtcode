import { assert, describe, it } from "@effect/vitest";

import { COMPUTER_VIEW_MIN_INTERVAL_MS } from "@t3tools/contracts";

import {
  buildComputerViewFrame,
  computerViewCaptureArguments,
  computerViewCaptureIntervalMs,
  computerViewCursorEvent,
  computerViewToolCall,
  toolResultCursor,
  toolResultImage,
  toolResultIsError,
  toolResultLive,
  toolResultText,
} from "./computerViewMcp.ts";

describe("computerViewCaptureArguments", () => {
  it("asks for standard JPEG when the viewer names no quality", () => {
    assert.deepStrictEqual(computerViewCaptureArguments({ display: 1, maxWidth: 1600 }), {
      display: 1,
      max_width: 1600,
      format: "jpeg",
      quality: 55,
    });
  });

  it("raises JPEG quality for the high setting", () => {
    assert.strictEqual(
      computerViewCaptureArguments({ display: 0, maxWidth: 1280, quality: "high" }).quality,
      85,
    );
  });

  it("switches to PNG for lossless", () => {
    assert.deepStrictEqual(
      computerViewCaptureArguments({ display: 0, maxWidth: 1280, quality: "lossless" }),
      { display: 0, max_width: 1280, format: "png" },
    );
  });
});

describe("computerViewCaptureIntervalMs", () => {
  it("keeps the host default without a frame rate", () => {
    assert.strictEqual(computerViewCaptureIntervalMs(undefined), COMPUTER_VIEW_MIN_INTERVAL_MS);
  });

  it("spaces captures for the requested rate", () => {
    assert.strictEqual(computerViewCaptureIntervalMs(5), 200);
    assert.strictEqual(computerViewCaptureIntervalMs(15), 67);
  });

  it("never captures faster than 30 frames a second", () => {
    assert.strictEqual(computerViewCaptureIntervalMs(120), 33);
  });
});

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

  it("maps scrolls over the point the viewer scrolled at", () => {
    assert.deepEqual(
      computerViewToolCall({ type: "scroll", x: 100, y: 100, direction: "down", amount: 3 }),
      { name: "scroll", arguments: { direction: "down", x: 100, y: 100, amount: 3 } },
    );
  });

  it("maps pointer motion to a hover, which moves the remote cursor", () => {
    assert.deepEqual(computerViewToolCall({ type: "move", x: 7, y: 9 }), {
      name: "hover",
      arguments: { x: 7, y: 9 },
    });
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

describe("remote cursor", () => {
  const hostLine = (fields: Record<string, unknown>) => ({
    content: [
      { type: "text", text: "display 0: screen origin (0, 0)" },
      { type: "image", data: "AAAA", mimeType: "image/jpeg" },
      { type: "text", text: `cursor: ${JSON.stringify(fields)}` },
    ],
  });

  it("asks the host for the pointer only when the viewer does", () => {
    assert.strictEqual(
      computerViewCaptureArguments({ display: 0, maxWidth: 1280, cursor: true }).cursor,
      true,
    );
    assert.isFalse("cursor" in computerViewCaptureArguments({ display: 0, maxWidth: 1280 }));
  });

  it("reads the host's cursor line", () => {
    const cursor = toolResultCursor(
      hostLine({
        id: "0x10003",
        visible: true,
        x: 700,
        y: 500,
        hotspot_x: 0,
        hotspot_y: 0,
        width: 32,
        height: 32,
        png: "PNG",
      }),
    );
    assert.deepStrictEqual(cursor, {
      id: "0x10003",
      visible: true,
      x: 700,
      y: 500,
      hotspotX: 0,
      hotspotY: 0,
      width: 32,
      height: 32,
      image: "PNG",
    });
    assert.isNull(toolResultCursor({ content: [{ type: "text", text: "no cursor" }] }));
  });

  it("sends each shape's image once and skips unchanged pointers", () => {
    const arrow = {
      id: "0x10003",
      visible: true,
      x: 1,
      y: 1,
      hotspotX: 0,
      hotspotY: 0,
      width: 32,
      height: 32,
      image: "PNG",
    };
    const first = computerViewCursorEvent(arrow, null, new Set());
    assert.strictEqual(first?.image, "PNG");
    assert.isNull(computerViewCursorEvent(arrow, arrow, new Set(["0x10003"])));
    const moved = computerViewCursorEvent({ ...arrow, x: 2 }, arrow, new Set(["0x10003"]));
    assert.strictEqual(moved?.x, 2);
    assert.isUndefined(moved?.image);
  });
});

describe("live capture", () => {
  it("asks for the live capture and the frame the viewer already has", () => {
    assert.deepStrictEqual(
      computerViewCaptureArguments({
        display: 0,
        maxWidth: 1600,
        live: { after: 41, waitMs: 500 },
      }),
      {
        display: 0,
        max_width: 1600,
        format: "jpeg",
        quality: 55,
        live: true,
        wait_ms: 500,
        after: 41,
      },
    );
  });

  it("leaves after out until the viewer has a frame", () => {
    const args = computerViewCaptureArguments({
      display: 0,
      maxWidth: 1600,
      live: { after: null, waitMs: 500 },
    });
    assert.strictEqual(args.live, true);
    assert.isFalse("after" in args);
  });

  it("reads the host's live line, with or without an image", () => {
    assert.deepStrictEqual(
      toolResultLive({
        content: [
          { type: "image", data: "AAAA", mimeType: "image/jpeg" },
          { type: "text", text: "display 0: screen origin (0, 0)" },
          { type: "text", text: 'live: {"seq":12,"changed":true}' },
        ],
      }),
      { seq: 12, changed: true },
    );
    assert.deepStrictEqual(
      toolResultLive({ content: [{ type: "text", text: 'live: {"seq":12,"changed":false}' }] }),
      { seq: 12, changed: false },
    );
  });

  it("treats a result without a live line as an ordinary screenshot", () => {
    assert.isNull(
      toolResultLive({ content: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }] }),
    );
    assert.isNull(toolResultLive({ content: [{ type: "text", text: "live: not json" }] }));
    assert.isNull(toolResultLive({ content: [{ type: "text", text: 'live: {"seq":"12"}' }] }));
  });
});
