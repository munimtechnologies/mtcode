import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DEV_BACKDROP,
  NIGHTLY_BACKDROP,
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarArtwork,
  resolveSidebarStageBackdropVariant,
  resolveSidebarStageFocusRingOffsetClass,
  StageBackdropArt,
  StageBackdropButtonArt,
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

  it("matches the focus-ring offset to each artwork palette", () => {
    expect(resolveSidebarStageFocusRingOffsetClass(NIGHTLY_BACKDROP)).toBe(
      "focus-visible:ring-offset-(--stage-night-bottom)",
    );
    expect(resolveSidebarStageFocusRingOffsetClass(DEV_BACKDROP)).toBe(
      "focus-visible:ring-offset-(--stage-art-bottom)",
    );
  });

  it.each([NIGHTLY_BACKDROP, DEV_BACKDROP] as const)(
    "uses unique SVG definition ids when $kind artwork is rendered more than once",
    (variant) => {
      const markup = renderToStaticMarkup(
        <>
          <StageBackdropArt variant={variant} />
          <StageBackdropArt variant={variant} />
        </>,
      );
      const ids = Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it("paints each artwork variant with theme-owned color tokens", () => {
    const nightlyMarkup = renderToStaticMarkup(<StageBackdropArt variant={NIGHTLY_BACKDROP} />);
    const devMarkup = renderToStaticMarkup(<StageBackdropArt variant={DEV_BACKDROP} />);

    expect(nightlyMarkup).toContain("var(--stage-night-bottom)");
    expect(nightlyMarkup).toContain("var(--stage-night-line)");
    expect(devMarkup).toContain("var(--stage-art-bottom)");
    expect(devMarkup).toContain("var(--stage-art-line)");
    expect(nightlyMarkup).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(devMarkup).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it.each([
    [NIGHTLY_BACKDROP, "96 0 8192 96"],
    [DEV_BACKDROP, "64 0 8192 96"],
  ] as const)("uses the compact crop inside the send button", (variant, viewBox) => {
    const markup = renderToStaticMarkup(<StageBackdropButtonArt variant={variant} />);

    expect(markup).toContain(`viewBox="${viewBox}"`);
    expect(markup).toContain(`stage-${variant.kind === "dev" ? "blueprint" : "nightly"}`);
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
    expect(
      resolveSidebarArtwork({ selection: "auto", stageLabel: "Dev", custom: [] }),
    ).toEqual(DEV_BACKDROP);
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
