import { describe, expect, it } from "vite-plus/test";

import type { GhosttyCell, GhosttySnapshot } from "./core";
import { renderGhosttySnapshot } from "./renderer";

const cell = (text: string, wide = 0): GhosttyCell => ({
  text,
  wide,
  foreground: { r: 255, g: 255, b: 255 },
  background: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  invisible: false,
  strikethrough: false,
  overline: false,
  underline: false,
  selected: false,
});

describe("renderGhosttySnapshot", () => {
  const snapshot = {
    cols: 3,
    rows: 1,
    background: { r: 0, g: 0, b: 0 },
    cursorY: -1,
    cursorVisible: false,
    dirtyRows: new Set([0]),
    rowData: [{ cells: [cell("a"), cell("b"), cell("c")], text: "abc" }],
  } as unknown as GhosttySnapshot;
  const renderSearch = (
    context: CanvasRenderingContext2D,
    searchHighlights: { row: number; startColumn: number; endColumn: number; active: boolean }[],
    dirtyRows = snapshot.dirtyRows,
  ) =>
    renderGhosttySnapshot({
      context,
      snapshot: { ...snapshot, dirtyRows },
      metrics: { width: 7.2, height: 16, baseline: 11 },
      fontSize: 12,
      fontFamily: "monospace",
      padding: 4,
      forceFull: false,
      cursorOn: false,
      searchHighlights,
    });
  const context = (events: string[], styles: string[] = []) =>
    new Proxy({ canvas: { width: 200, height: 40 } } as unknown as CanvasRenderingContext2D, {
      get: (target, key) =>
        key === "canvas"
          ? target.canvas
          : key === "fillRect"
            ? () => events.push("fill")
            : key === "fillText"
              ? () => events.push("text")
              : () => {},
      set: (_target, key, value) => (key === "fillStyle" && styles.push(String(value)), true),
    });
  const highlight = { row: 0, startColumn: 0, endColumn: 0, active: false };
  it("highlight fill painted before text for a drawn row", () => {
    const events: string[] = [];
    renderSearch(context(events), [{ ...highlight, endColumn: 1 }]);
    expect(events).toEqual(["fill", "fill", "text"]);
  });

  it("active vs inactive color", () => {
    const styles: string[] = [];
    renderSearch(context([], styles), [
      highlight,
      { ...highlight, startColumn: 1, endColumn: 1, active: true },
    ]);
    expect(styles).toContain("rgba(249, 115, 22, 0.62)");
  });

  it("rows not in the redraw set are not painted", () => {
    const events: string[] = [];
    renderSearch(context(events), [highlight], new Set());
    expect(events).toEqual([]);
  });
});
