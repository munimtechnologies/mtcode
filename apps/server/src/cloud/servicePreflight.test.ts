import { expect, it } from "@effect/vitest";

import { resolveAppDisplayName } from "../appDisplayName.ts";
import { runServicePreflight } from "./servicePreflight.ts";

it.each([1, 2])("blocks legacy launcher protocol %i", (launcherProtocol) => {
  expect(
    runServicePreflight({
      databasePath: "/missing/state.sqlite",
      launcherProtocol,
      version: "1.2.3",
    }),
  ).toEqual({
    status: "blocked",
    version: "1.2.3",
    // The brand is whatever build this runs in, so assert against the same source.
    reason: `This release requires a newer ${resolveAppDisplayName()} service launcher. Update it on the server machine.`,
  });
});
