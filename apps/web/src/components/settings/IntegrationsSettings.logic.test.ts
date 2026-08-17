import { describe, expect, it } from "vite-plus/test";

import { importFailureReason } from "./IntegrationsSettings";

// Mirrors `BrowserImportFailedError.message`, which IPC flattens to a string
// before the renderer sees it.
const failure = (reason: string) => ({
  message: `Importing cookies from safari failed: ${reason}.`,
});

describe("importFailureReason", () => {
  it("recovers the reason token from the flattened message", () => {
    // The whole import error path — including the Full Disk Access dialog —
    // depends on this token surviving the trip through IPC.
    expect(importFailureReason(failure("needsFullDiskAccess"))).toBe("needsFullDiskAccess");
    expect(importFailureReason(failure("browserRunning"))).toBe("browserRunning");
    expect(importFailureReason(failure("readFailed"))).toBe("readFailed");
  });

  it("falls back to readFailed for anything it cannot classify", () => {
    expect(importFailureReason(new Error("something else entirely"))).toBe("readFailed");
    expect(importFailureReason(undefined)).toBe("readFailed");
  });
});
