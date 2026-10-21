import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { presetConditions } from "../artwork/skyConditions";
import {
  DEV_BACKDROP,
  NIGHTLY_BACKDROP,
  StageBackdropArt,
  StageBackdropButtonArt,
} from "./SidebarStageBackdrop";

// Gradients and patterns resolve url(#id) document-wide, so a repeated id would paint one
// backdrop with another's definitions.
it.each([
  NIGHTLY_BACKDROP,
  DEV_BACKDROP,
  { kind: "sky", conditions: presetConditions("dusk", "storm"), name: "Dusk · Storm" },
] as const)(
  "gives every $kind backdrop its own SVG definitions when two are on the page",
  async (variant) => {
    await using screen = await render(
      <>
        <StageBackdropArt variant={variant} />
        <StageBackdropArt variant={variant} />
      </>,
    );
    const [first, second] = screen.container.querySelectorAll("svg");
    const ids = (svg: Element | undefined) => [...svg!.querySelectorAll("[id]")].map((el) => el.id);

    expect(ids(first).length).toBeGreaterThan(0);
    for (const id of ids(first)) {
      expect(document.querySelectorAll(`#${CSS.escape(id)}`)).toHaveLength(1);
    }
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([]);
    for (const reference of second!.querySelectorAll("[fill^='url(#'], [filter^='url(#']")) {
      const target = (reference.getAttribute("fill") ?? reference.getAttribute("filter"))!.slice(
        5,
        -1,
      );
      expect(second!.querySelector(`#${CSS.escape(target)}`)).not.toBeNull();
    }
  },
);

it("paints each artwork variant with theme-owned color tokens", async () => {
  await using screen = await render(<StageBackdropArt variant={NIGHTLY_BACKDROP} />);
  const nightlyMarkup = screen.container.innerHTML;
  await screen.rerender(<StageBackdropArt variant={DEV_BACKDROP} />);
  const devMarkup = screen.container.innerHTML;

  expect(nightlyMarkup).toContain("var(--stage-night-bottom)");
  expect(nightlyMarkup).toContain("var(--stage-night-line)");
  expect(devMarkup).toContain("var(--stage-art-bottom)");
  expect(devMarkup).toContain("var(--stage-art-line)");
  expect(nightlyMarkup).not.toMatch(/#[0-9a-f]{3,8}/i);
  expect(devMarkup).not.toMatch(/#[0-9a-f]{3,8}/i);
});

it.each([
  [NIGHTLY_BACKDROP, "96 0 8192 96", "nightly"],
  [DEV_BACKDROP, "64 0 8192 96", "blueprint"],
] as const)("uses the compact crop inside the send button", async (variant, viewBox, art) => {
  await using screen = await render(<StageBackdropButtonArt variant={variant} />);
  const svg = screen.container.querySelector(`svg[data-stage-art="${art}"]`);

  expect(svg).not.toBeNull();
  expect(svg!.getAttribute("viewBox")).toBe(viewBox);
});
