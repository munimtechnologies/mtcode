import { describe, expect, it } from "vite-plus/test";
import type { UsageProviderKind } from "@t3tools/contracts";

import { visibleLimitsProviders } from "./usageProviders";

const row = (windows: readonly unknown[]) => ({ snapshot: { windows } });

describe("visibleLimitsProviders", () => {
  it("always shows Codex, Claude, and Cursor, even with empty windows", () => {
    expect(visibleLimitsProviders(new Map())).toEqual(["codex", "claude", "cursor"]);
  });

  it("adds other providers only once they report a window", () => {
    const byProvider = new Map<
      UsageProviderKind,
      ReadonlyArray<{ readonly snapshot: { readonly windows: readonly unknown[] } }>
    >([
      ["grok", [row([{ id: "week" }])]],
      ["cursor", [row([])]],
    ]);

    expect(visibleLimitsProviders(byProvider)).toEqual(["codex", "claude", "cursor", "grok"]);
  });
});
