import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { APP_DISPLAY_VERSION } from "../../branding";
import { AnchoredToastProvider } from "../ui/toast";
import { AboutVersionTitle } from "./AboutVersionTitle";

it("copies the version without a notification", async () => {
  await using screen = await render(
    <AnchoredToastProvider>
      <AboutVersionTitle />
    </AnchoredToastProvider>,
  );
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  await screen.getByRole("button", { name: `Copy version ${APP_DISPLAY_VERSION}` }).click();

  expect(write).toHaveBeenCalledWith(APP_DISPLAY_VERSION);
  await expect.element(page.getByText(/^Copied!?$/)).not.toBeInTheDocument();
});
