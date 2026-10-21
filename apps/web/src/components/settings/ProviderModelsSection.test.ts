import { describe, expect, it } from "vite-plus/test";

import {
  ALL_LABEL_ID,
  HIDDEN_LABEL_ID,
  HIDDEN_SLOT_ID,
  resolveModelListDrop,
  type ModelListDrop,
} from "./ProviderModelsSection";

function drop(overrides: Partial<ModelListDrop> & Pick<ModelListDrop, "activeId" | "overId">) {
  return resolveModelListDrop({
    items: ["fav", ALL_LABEL_ID, "a", "b", HIDDEN_LABEL_ID, "c", "d"],
    favoriteModels: ["fav"],
    hiddenModels: ["c", "d"],
    customSlugs: new Set(),
    ...overrides,
  });
}

describe("resolveModelListDrop", () => {
  it("returns null when dropped on itself or on an unknown id", () => {
    expect(drop({ activeId: "a", overId: "a" })).toBeNull();
    expect(drop({ activeId: "a", overId: "nope" })).toBeNull();
    expect(drop({ activeId: "nope", overId: "a" })).toBeNull();
  });

  it("reorders within a segment without touching favorites or hidden", () => {
    expect(drop({ activeId: "a", overId: "b" })).toEqual({
      modelOrder: ["fav", "b", "a", "c", "d"],
      favoriteModels: ["fav"],
      hiddenModels: ["c", "d"],
    });
    expect(drop({ activeId: "d", overId: "c" })?.modelOrder).toEqual(["fav", "a", "b", "d", "c"]);
  });

  it("hides and unfavorites a model dropped below the hidden label", () => {
    expect(drop({ activeId: "fav", overId: HIDDEN_LABEL_ID })).toEqual({
      modelOrder: ["a", "b", "fav", "c", "d"],
      favoriteModels: [],
      hiddenModels: ["c", "d", "fav"],
    });
  });

  it("unhides a model dropped above the hidden label", () => {
    expect(drop({ activeId: "c", overId: "b" })).toEqual({
      modelOrder: ["fav", "a", "c", "b", "d"],
      favoriteModels: ["fav"],
      hiddenModels: ["d"],
    });
    expect(drop({ activeId: "c", overId: HIDDEN_LABEL_ID })?.hiddenModels).toEqual(["d"]);
  });

  it("moves between favorites and the rest across the all label", () => {
    expect(drop({ activeId: "a", overId: "fav" })?.favoriteModels).toEqual(["a", "fav"]);
    expect(drop({ activeId: "a", overId: ALL_LABEL_ID })?.favoriteModels).toEqual(["fav", "a"]);
    expect(drop({ activeId: "fav", overId: ALL_LABEL_ID })).toEqual({
      modelOrder: ["fav", "a", "b", "c", "d"],
      favoriteModels: [],
      hiddenModels: ["c", "d"],
    });
  });

  it("drops onto an empty segment slot without persisting the slot", () => {
    expect(
      drop({
        items: ["a", "b", HIDDEN_LABEL_ID, HIDDEN_SLOT_ID],
        hiddenModels: [],
        activeId: "a",
        overId: HIDDEN_SLOT_ID,
      }),
    ).toEqual({ modelOrder: ["b", "a"], favoriteModels: ["fav"], hiddenModels: ["a"] });
  });

  it("refuses to hide custom models", () => {
    expect(drop({ activeId: "a", overId: "d", customSlugs: new Set(["a"]) })).toBeNull();
  });

  it("keeps a hidden favorite hidden and preserves entries for unlisted models", () => {
    expect(
      drop({
        activeId: "a",
        overId: "b",
        favoriteModels: ["gone-fav", "fav"],
        hiddenModels: ["fav", "gone-hidden", "c", "d"],
      }),
    ).toEqual({
      modelOrder: ["fav", "b", "a", "c", "d"],
      favoriteModels: ["gone-fav", "fav"],
      hiddenModels: ["fav", "gone-hidden", "c", "d"],
    });
  });
});
