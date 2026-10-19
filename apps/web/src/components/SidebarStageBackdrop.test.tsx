import { describe, expect, it } from "vite-plus/test";

import {
  DEV_BACKDROP,
  NIGHTLY_BACKDROP,
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarArtwork,
  resolveSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("resolves stage artwork only when enabled", () => {
    expect(resolveSidebarStageBackdropVariant("Dev")).toEqual(DEV_BACKDROP);
    expect(resolveSidebarStageBackdropVariant("Nightly")).toEqual(NIGHTLY_BACKDROP);
    expect(resolveSidebarStageBackdropVariant("Dev", false)).toBeNull();
    expect(resolveSidebarStageBackdropVariant("Alpha")).toBeNull();
  });

  it("resolves supported environment pill labels", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Dev")).toBe("Dev");
    expect(resolveEnvironmentIdentificationPillLabel("nightly")).toBe("Nightly");
    expect(resolveEnvironmentIdentificationPillLabel("Latest")).toBeNull();
    expect(resolveEnvironmentIdentificationPillLabel("Alpha")).toBeNull();
  });
});

describe("resolveSidebarArtwork", () => {
  const custom = [{ id: "art_1", name: "Skyline", image: "data:image/png;base64,AAAA" }];

  it("defers to the build channel only for auto", () => {
    expect(resolveSidebarArtwork({ selection: "auto", stageLabel: "Nightly", custom })).toEqual(
      NIGHTLY_BACKDROP,
    );
    // A release build has no channel artwork, which is why picking one matters.
    expect(resolveSidebarArtwork({ selection: "auto", stageLabel: "", custom })).toBeNull();
  });

  it("honours an explicit pick regardless of channel", () => {
    expect(resolveSidebarArtwork({ selection: "night", stageLabel: "", custom })).toEqual(
      NIGHTLY_BACKDROP,
    );
    expect(resolveSidebarArtwork({ selection: "day", stageLabel: "Nightly", custom })).toEqual(
      DEV_BACKDROP,
    );
    expect(resolveSidebarArtwork({ selection: "none", stageLabel: "Nightly", custom })).toBeNull();
  });

  it("draws Night · Cloudy with the Night sky scene, and other presets as drawn skies", () => {
    expect(
      resolveSidebarArtwork({ selection: "sky-night-cloudy", stageLabel: "", custom }),
    ).toEqual(NIGHTLY_BACKDROP);
    expect(
      resolveSidebarArtwork({ selection: "sky-night-clear", stageLabel: "", custom }),
    ).toMatchObject({ kind: "sky", name: "Night · Clear" });
  });

  it("renders the account's own artwork, and nothing once it is deleted", () => {
    expect(resolveSidebarArtwork({ selection: "art_1", stageLabel: "", custom })).toEqual({
      kind: "custom",
      image: custom[0]!.image,
      name: custom[0]!.name,
    });
    expect(resolveSidebarArtwork({ selection: "art_1", stageLabel: "", custom: [] })).toBeNull();
  });

  it("stays out of the way when artwork is switched off entirely", () => {
    expect(
      resolveSidebarArtwork({ selection: "night", stageLabel: "", custom, enabled: false }),
    ).toBeNull();
  });
});

describe("named artwork defaults", () => {
  it("draws the named scene even when the environment mode would hide artwork", () => {
    // The picker is the user's answer; the palette/mode heuristics upstream
    // uses to decide whether art suits the theme must not override it.
    expect(
      resolveSidebarArtwork({ selection: "night", stageLabel: "", custom: [], enabled: true }),
    ).toEqual(NIGHTLY_BACKDROP);
  });

  it("keeps the legacy auto value working for older settings files", () => {
    expect(resolveSidebarArtwork({ selection: "auto", stageLabel: "Dev", custom: [] })).toEqual(
      DEV_BACKDROP,
    );
  });
});

describe("the header renders what the picker chose", () => {
  it("resolves a named scene with no help from the build channel", () => {
    // Regression: the sidebar header called the stage-label resolver directly,
    // so a picked scene never reached the renderer on a release build.
    expect(resolveSidebarArtwork({ selection: "night", stageLabel: "", custom: [] })).toEqual(
      NIGHTLY_BACKDROP,
    );
    expect(resolveSidebarArtwork({ selection: "day", stageLabel: "", custom: [] })).toEqual(
      DEV_BACKDROP,
    );
  });
});
