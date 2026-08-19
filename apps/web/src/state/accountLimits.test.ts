import { describe, expect, it } from "@effect/vitest";
import type {
  AccountLimitsSnapshot,
  EnvironmentId,
  ServerProvider,
  UsageProviderKind,
} from "@t3tools/contracts";

import { type EnvironmentLimitsStatus, mergeEnvironmentLimits } from "./accountLimits";

const snapshot = (
  provider: UsageProviderKind,
  overrides: Partial<AccountLimitsSnapshot> = {},
): AccountLimitsSnapshot => ({
  provider,
  plan: null,
  windows: [],
  asOf: "2026-08-15T12:00:00.000Z",
  source: "live",
  ...overrides,
});

const provider = (instanceId: string, overrides: Record<string, unknown> = {}) =>
  ({
    instanceId,
    driver: "codex",
    auth: { status: "unknown" },
    ...overrides,
  }) as unknown as ServerProvider;

const status = (
  environmentId: string,
  overrides: Partial<EnvironmentLimitsStatus> = {},
): EnvironmentLimitsStatus => ({
  environmentId: environmentId as EnvironmentId,
  environmentLabel: environmentId,
  environmentIsPrimary: false,
  isPending: false,
  snapshots: [],
  providers: null,
  ...overrides,
});

describe("mergeEnvironmentLimits", () => {
  it("rows differing only in content are not duplicates - the stamp alone must not collapse them", () => {
    const window = (usedPercent: number) => ({
      id: "seven_day",
      label: "Week",
      usedPercent,
      resetsAt: null,
      windowMinutes: 10080,
    });
    const merged = mergeEnvironmentLimits([
      status("desktop", {
        snapshots: [snapshot("codex", { windows: [window(10)] as never })],
      }),
      status("laptop", {
        snapshots: [snapshot("codex", { windows: [window(90)] as never })],
      }),
    ]);
    expect(merged.get("codex")?.map((row) => row.snapshot.windows[0]?.usedPercent)).toEqual([
      10, 90,
    ]);
  });

  it("unnamed instances caption with the app-wide humanized names", () => {
    const merged = mergeEnvironmentLimits([
      status("laptop", {
        snapshots: [
          snapshot("codex", { instanceId: "codex_a" as never }),
          snapshot("codex", { instanceId: "codex_b" as never }),
        ],
        providers: [provider("codex_a"), provider("codex_b")] as never,
      }),
    ]);
    expect(merged.get("codex")?.map((row) => row.instanceLabel)).toEqual(["Codex A", "Codex B"]);
  });

  it("a display name shared by two different instances falls back to instance ids", () => {
    const merged = mergeEnvironmentLimits([
      status("laptop", {
        snapshots: [
          snapshot("codex", { instanceId: "codex_a" as never }),
          snapshot("codex", { instanceId: "codex_b" as never }),
        ],
        providers: [
          provider("codex_a", { displayName: "Work" }),
          provider("codex_b", { displayName: "Work" }),
        ] as never,
      }),
    ]);
    expect(merged.get("codex")?.map((row) => row.instanceLabel)).toEqual(["codex_a", "codex_b"]);
  });

  it("one instance seen from two environments keeps its shared display name", () => {
    const rows = mergeEnvironmentLimits([
      status("desktop", {
        snapshots: [snapshot("codex", { instanceId: "codex_a" as never })],
        providers: [provider("codex_a", { displayName: "Work" })] as never,
      }),
      status("laptop", {
        snapshots: [
          snapshot("codex", { instanceId: "codex_a" as never, asOf: "2026-08-15T13:00:00.000Z" }),
        ],
        providers: [provider("codex_a", { displayName: "Work" })] as never,
      }),
    ]).get("codex");
    expect(rows?.map((row) => row.instanceLabel)).toEqual(["Work", "Work"]);
  });

  it("keeps one row per instance instead of collapsing a provider to one slot", () => {
    const merged = mergeEnvironmentLimits([
      status("laptop", {
        snapshots: [
          snapshot("codex", { instanceId: "codex_a" as never, asOf: "2026-08-15T12:00:01.000Z" }),
          snapshot("codex", { instanceId: "codex_b" as never, asOf: "2026-08-15T12:00:02.000Z" }),
        ],
      }),
    ]);
    expect(merged.get("codex")?.map((row) => row.instanceLabel)).toEqual(["codex_a", "codex_b"]);
  });

  it("collapses the same subscription windows reported from several computers", () => {
    const windows = [
      {
        id: "month",
        label: "Month",
        usedPercent: 100,
        resetsAt: "2026-09-08T14:35:12.000Z",
        windowMinutes: 43200,
      },
      {
        id: "auto",
        label: "Auto",
        usedPercent: 73,
        resetsAt: "2026-09-08T14:35:40.000Z",
        windowMinutes: 43200,
      },
      {
        id: "api",
        label: "API",
        usedPercent: 100,
        resetsAt: "2026-09-08T14:35:00.000Z",
        windowMinutes: 43200,
      },
    ] as const;
    const merged = mergeEnvironmentLimits([
      status("desktop", {
        snapshots: [
          snapshot("cursor", {
            instanceId: "cursor" as never,
            asOf: "2026-08-15T12:00:00.000Z",
            windows: [...windows] as never,
          }),
        ],
      }),
      status("laptop", {
        environmentIsPrimary: true,
        snapshots: [
          snapshot("cursor", {
            instanceId: "cursor_work" as never,
            asOf: "2026-08-15T11:00:00.000Z",
            windows: [...windows] as never,
          }),
        ],
      }),
      status("workstation", {
        snapshots: [
          snapshot("cursor", {
            instanceId: "cursor" as never,
            asOf: "2026-08-15T13:00:00.000Z",
            windows: [windows[0], { ...windows[1], usedPercent: 73.4 }, windows[2]] as never,
          }),
        ],
      }),
    ]);
    const rows = merged.get("cursor") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.environmentIsPrimary).toBe(true);
    expect(rows[0]?.environmentId).toBe("laptop");
  });

  it("does not collapse empty snapshots across environments", () => {
    const merged = mergeEnvironmentLimits([
      status("desktop", {
        snapshots: [snapshot("codex", { asOf: "2026-08-15T12:00:09.000Z" })],
      }),
      status("laptop", {
        snapshots: [snapshot("codex", { asOf: "2026-08-15T11:00:00.000Z" })],
      }),
    ]);
    expect(merged.get("codex")?.map((row) => row.environmentId)).toEqual(["desktop", "laptop"]);
  });

  it("folds a legacy server's unkeyed snapshots onto the default instance, freshest wins", () => {
    const merged = mergeEnvironmentLimits([
      status("laptop", {
        snapshots: [
          snapshot("claude", { asOf: "2026-08-15T11:00:00.000Z" }),
          snapshot("claude", {
            instanceId: "claudeAgent" as never,
            asOf: "2026-08-15T12:00:00.000Z",
          }),
        ],
      }),
    ]);
    const rows = merged.get("claude") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.snapshot.asOf).toBe("2026-08-15T12:00:00.000Z");
  });

  it("does not treat an unkeyed Cursor snapshot as a Codex account", () => {
    const merged = mergeEnvironmentLimits([
      status("laptop", {
        snapshots: [snapshot("cursor"), snapshot("codex")],
      }),
    ]);
    expect(merged.get("cursor")).toHaveLength(1);
    expect(merged.get("codex")).toHaveLength(1);
  });

  it("collapses byte-identical rows reported by two environments on one machine", () => {
    const twin = snapshot("codex", {
      instanceId: "codex_a" as never,
      asOf: "2026-08-15T12:00:05.000Z",
    });
    const merged = mergeEnvironmentLimits([
      status("worktree-1", { snapshots: [twin] }),
      status("worktree-2", { snapshots: [twin] }),
    ]);
    expect(merged.get("codex")).toHaveLength(1);
  });

  it("labels rows from the provider config already on the wire", () => {
    const merged = mergeEnvironmentLimits([
      status("laptop", {
        providers: [
          provider("claude_main", { driver: "claudeAgent", displayName: "Claude Main" }),
          // An authenticated email is deliberately NOT a label source: the
          // provider UI blurs emails until clicked, and a caption must not
          // leak what that redaction protects.
          provider("claude_partner", {
            driver: "claudeAgent",
            auth: { status: "authenticated", email: "partner@example.com" },
          }),
        ],
        snapshots: [
          snapshot("claude", { instanceId: "claude_main" as never }),
          snapshot("claude", { instanceId: "claude_partner" as never }),
          snapshot("claude", { instanceId: "claude_unknown" as never }),
        ],
      }),
    ]);
    expect(merged.get("claude")?.map((row) => row.instanceLabel)).toEqual([
      "Claude Main",
      // Unnamed but configured: the app-wide resolver humanizes the id -
      // and the authenticated email above is still not a label source.
      "Claude Partner",
      // Not in the provider config at all: nothing to resolve, raw id.
      "claude_unknown",
    ]);
  });
});
