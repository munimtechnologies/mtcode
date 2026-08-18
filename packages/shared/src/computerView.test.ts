import { assert, describe, it } from "@effect/vitest";

import {
  mapViewerPointToScreen,
  parseComputerViewDisplays,
  readJpegSize,
  readPngSize,
  selectComputerViewDisplay,
} from "./computerView.ts";

describe("parseComputerViewDisplays", () => {
  it("parses macOS list_displays lines", () => {
    const displays = parseComputerViewDisplays(`2 displays:
[0] 2880x1800 at (0, 0)
[1] 1920x1080 at (2880, 100)`);
    assert.deepEqual(displays, [
      {
        index: 0,
        label: "Display 0",
        width: 2880,
        height: 1800,
        x: 0,
        y: 0,
        primary: false,
      },
      {
        index: 1,
        label: "Display 1",
        width: 1920,
        height: 1080,
        x: 2880,
        y: 100,
        primary: false,
      },
    ]);
  });

  it("parses Windows/Linux list_displays lines with names", () => {
    const displays = parseComputerViewDisplays(
      `[0] Built-in Display  2880x1800  at (0,0)  PRIMARY\n[1] HDMI  1920x1080  at (-1920,0)`,
    );
    assert.equal(displays[0]?.primary, true);
    assert.equal(displays[0]?.label, "Built-in Display");
    assert.equal(displays[1]?.x, -1920);
  });
});

describe("selectComputerViewDisplay", () => {
  it("prefers an explicit index, then PRIMARY, then the first entry", () => {
    const displays = parseComputerViewDisplays(
      `[0] A  100x100  at (0,0)\n[1] B  200x200  at (100,0)  PRIMARY`,
    );
    assert.equal(selectComputerViewDisplay(displays, 0)?.index, 0);
    assert.equal(selectComputerViewDisplay(displays, undefined)?.index, 1);
    assert.equal(selectComputerViewDisplay([], undefined), null);
  });
});

describe("mapViewerPointToScreen", () => {
  it("maps the centre of a contain-fitted image to the display centre", () => {
    const point = mapViewerPointToScreen({
      clientX: 100,
      clientY: 100,
      elementLeft: 0,
      elementTop: 0,
      elementWidth: 200,
      elementHeight: 200,
      imageWidth: 100,
      imageHeight: 100,
      screenX: 10,
      screenY: 20,
      screenWidth: 1000,
      screenHeight: 800,
    });
    assert.deepEqual(point, { x: 510, y: 420 });
  });

  it("returns null for clicks in the letterbox", () => {
    const point = mapViewerPointToScreen({
      clientX: 5,
      clientY: 5,
      elementLeft: 0,
      elementTop: 0,
      elementWidth: 200,
      elementHeight: 100,
      imageWidth: 100,
      imageHeight: 100,
      screenX: 0,
      screenY: 0,
      screenWidth: 1000,
      screenHeight: 1000,
    });
    assert.equal(point, null);
  });
});

describe("readPngSize", () => {
  it("reads IHDR dimensions", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x05, 0xa0, 0x00, 0x00, 0x03, 0x20, 0x00, 0x00,
    ]);
    assert.deepEqual(readPngSize(bytes), { width: 1440, height: 800 });
  });
});

describe("readJpegSize", () => {
  it("reads SOF0 dimensions", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x20, 0x05, 0xa0, 0x03,
      0x01, 0x22, 0x00,
    ]);
    assert.deepEqual(readJpegSize(bytes), { width: 1440, height: 800 });
  });
});
