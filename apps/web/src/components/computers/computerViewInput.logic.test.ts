import { describe, expect, it } from "vite-plus/test";

import {
  classifyPointerGesture,
  computerViewFrameDataUrl,
  mapKeyboardEventToComputerViewInput,
  mapWheelToComputerViewInput,
} from "./computerViewInput.logic";

const noModifiers = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe("mapKeyboardEventToComputerViewInput", () => {
  it("types plain printable characters so layout and shift are preserved", () => {
    expect(mapKeyboardEventToComputerViewInput({ key: "a", ...noModifiers })).toEqual({
      type: "type",
      text: "a",
    });
    expect(
      mapKeyboardEventToComputerViewInput({ key: "!", ...noModifiers, shiftKey: true }),
    ).toEqual({ type: "type", text: "!" });
  });

  it("sends chords as key presses with modifiers", () => {
    expect(
      mapKeyboardEventToComputerViewInput({ key: "s", ...noModifiers, metaKey: true }),
    ).toEqual({ type: "key", key: "s", modifiers: ["cmd"] });
    expect(
      mapKeyboardEventToComputerViewInput({
        key: "P",
        ...noModifiers,
        metaKey: true,
        shiftKey: true,
      }),
    ).toEqual({ type: "key", key: "p", modifiers: ["cmd", "shift"] });
  });

  it("maps named keys and carries their modifiers", () => {
    expect(mapKeyboardEventToComputerViewInput({ key: "Enter", ...noModifiers })).toEqual({
      type: "key",
      key: "return",
    });
    expect(mapKeyboardEventToComputerViewInput({ key: "Backspace", ...noModifiers })).toEqual({
      type: "key",
      key: "backspace",
    });
    expect(
      mapKeyboardEventToComputerViewInput({ key: "ArrowLeft", ...noModifiers, altKey: true }),
    ).toEqual({ type: "key", key: "left", modifiers: ["alt"] });
    expect(mapKeyboardEventToComputerViewInput({ key: "F5", ...noModifiers })).toEqual({
      type: "key",
      key: "f5",
    });
  });

  it("ignores bare modifier presses", () => {
    expect(
      mapKeyboardEventToComputerViewInput({ key: "Shift", ...noModifiers, shiftKey: true }),
    ).toBeNull();
    expect(
      mapKeyboardEventToComputerViewInput({ key: "Meta", ...noModifiers, metaKey: true }),
    ).toBeNull();
  });
});

describe("mapWheelToComputerViewInput", () => {
  it("scrolls on the dominant axis with a clamped line amount", () => {
    expect(mapWheelToComputerViewInput({ deltaX: 4, deltaY: -120, x: 10, y: 20 })).toEqual({
      type: "scroll",
      x: 10,
      y: 20,
      direction: "up",
      amount: 3,
    });
    expect(mapWheelToComputerViewInput({ deltaX: 90, deltaY: 10, x: 1, y: 2 })).toEqual({
      type: "scroll",
      x: 1,
      y: 2,
      direction: "right",
      amount: 2,
    });
  });

  it("always scrolls at least one line and ignores zero deltas", () => {
    expect(mapWheelToComputerViewInput({ deltaX: 0, deltaY: 3, x: 0, y: 0 })).toEqual({
      type: "scroll",
      x: 0,
      y: 0,
      direction: "down",
      amount: 1,
    });
    expect(mapWheelToComputerViewInput({ deltaX: 0, deltaY: 0, x: 0, y: 0 })).toBeNull();
  });
});

describe("classifyPointerGesture", () => {
  it("keeps small movements as clicks at the release point", () => {
    expect(
      classifyPointerGesture({
        from: { x: 100, y: 100 },
        to: { x: 102, y: 101 },
        button: "left",
        clickCount: 1,
      }),
    ).toEqual({ type: "click", x: 102, y: 101 });
  });

  it("promotes larger movements to drags", () => {
    expect(
      classifyPointerGesture({
        from: { x: 100, y: 100 },
        to: { x: 160, y: 130 },
        button: "left",
        clickCount: 1,
      }),
    ).toEqual({ type: "drag", fromX: 100, fromY: 100, toX: 160, toY: 130 });
  });

  it("clamps click counts and keeps right-button gestures as right clicks", () => {
    expect(
      classifyPointerGesture({
        from: { x: 5, y: 5 },
        to: { x: 5, y: 5 },
        button: "left",
        clickCount: 7,
      }),
    ).toEqual({ type: "click", x: 5, y: 5, clickCount: 3 });
    expect(
      classifyPointerGesture({
        from: { x: 0, y: 0 },
        to: { x: 50, y: 50 },
        button: "right",
        clickCount: 1,
      }),
    ).toEqual({ type: "click", x: 50, y: 50, button: "right" });
  });
});

describe("computerViewFrameDataUrl", () => {
  it("builds a data URL from the streamed mime type", () => {
    expect(computerViewFrameDataUrl({ mimeType: "image/jpeg", data: "abc" })).toBe(
      "data:image/jpeg;base64,abc",
    );
  });
});
