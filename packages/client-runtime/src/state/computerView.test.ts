import type { ComputerViewFrameEvent } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { applyComputerViewStreamEvent, EMPTY_COMPUTER_VIEW_STATE } from "./computerView.ts";

const frame: ComputerViewFrameEvent = {
  type: "frame",
  displayIndex: 0,
  mimeType: "image/jpeg",
  data: "b64",
  width: 960,
  height: 600,
  screenX: 0,
  screenY: 0,
  screenWidth: 2880,
  screenHeight: 1800,
};

const display = {
  index: 0,
  label: "Built-in Display",
  width: 2880,
  height: 1800,
  x: 0,
  y: 0,
  primary: true,
};

describe("applyComputerViewStreamEvent", () => {
  it("records displays and the selection on ready", () => {
    const state = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, {
      type: "ready",
      displays: [display],
      selectedDisplay: 0,
    });
    expect(state.displays).toEqual([display]);
    expect(state.selectedDisplay).toBe(0);
    expect(state.frame).toBeNull();
  });

  it("keeps the latest frame and clears a stale status", () => {
    const withStatus = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, {
      type: "status",
      message: "capturing…",
    });
    expect(withStatus.status).toBe("capturing…");
    const withFrame = applyComputerViewStreamEvent(withStatus, frame);
    expect(withFrame.frame).toBe(frame);
    expect(withFrame.status).toBeNull();
  });

  it("drops the previous frame when a new ready event arrives", () => {
    const withFrame = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, frame);
    const reannounced = applyComputerViewStreamEvent(withFrame, {
      type: "ready",
      displays: [display],
      selectedDisplay: 0,
    });
    expect(reannounced.frame).toBeNull();
  });

  it("keeps the last frame visible while statuses stream", () => {
    const withFrame = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, frame);
    const stalled = applyComputerViewStreamEvent(withFrame, {
      type: "status",
      message: "Screen capture failed.",
    });
    expect(stalled.frame).toBe(frame);
    expect(stalled.status).toBe("Screen capture failed.");
  });
});
