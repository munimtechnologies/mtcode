import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import { DESKTOP_APP_NAMES, windowsDesktopExecutableCandidates } from "./desktopLaunch.ts";

it("lists stable and nightly desktop app names", () => {
  assert.include(DESKTOP_APP_NAMES as ReadonlyArray<string>, "T3 Code (Alpha)");
  assert.include(DESKTOP_APP_NAMES as ReadonlyArray<string>, "T3 Code (Nightly)");
});

it("resolves common Windows install paths under Local AppData", () => {
  const localAppData = "/Users/test/AppData/Local";
  const candidates = windowsDesktopExecutableCandidates(localAppData);
  assert.include(
    candidates,
    NodePath.join(localAppData, "Programs", "t3-code", "T3 Code (Alpha).exe"),
  );
  assert.include(
    candidates,
    NodePath.join(localAppData, "Programs", "T3 Code (Nightly)", "T3 Code (Nightly).exe"),
  );
});
