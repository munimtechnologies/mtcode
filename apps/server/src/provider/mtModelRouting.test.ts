import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { buildMtRouteCandidates, resolveMtModelForTurn } from "./mtModelRouting.ts";

describe("buildMtRouteCandidates", () => {
  it("skips the virtual MT instance and exhausted custom/legacy models", () => {
    const candidates = buildMtRouteCandidates(
      [
        {
          instanceId: ProviderInstanceId.make("mt"),
          driver: ProviderDriverKind.make("mt"),
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "unknown" },
          checkedAt: "2026-08-18T00:00:00.000Z",
          models: [{ slug: "mt-auto", name: "MT Model", isCustom: false, capabilities: null }],
          slashCommands: [],
          skills: [],
        },
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "unknown" },
          checkedAt: "2026-08-18T00:00:00.000Z",
          models: [
            { slug: "claude-sonnet-5", name: "Sonnet 5", isCustom: false, capabilities: null },
            { slug: "old-opus", name: "Old", isCustom: false, isLegacy: true, capabilities: null },
          ],
          slashCommands: [],
          skills: [],
        },
      ],
      [
        {
          provider: "claude",
          instanceId: ProviderInstanceId.make("claudeAgent"),
          plan: "pro",
          windows: [
            { id: "five_hour", label: "5h", usedPercent: 40, resetsAt: null, windowMinutes: 300 },
          ],
          source: "live",
          asOf: "2026-08-18T00:00:00.000Z",
        },
      ],
    );
    expect(candidates).toEqual([
      {
        instanceId: "claudeAgent",
        driverKind: "claudeAgent",
        model: "claude-sonnet-5",
        ready: true,
        usedPercent: 40,
      },
    ]);
  });

  it("marks warning and unauthenticated providers as not ready", () => {
    const candidates = buildMtRouteCandidates([
      {
        instanceId: ProviderInstanceId.make("openai"),
        driver: ProviderDriverKind.make("openCode"),
        enabled: true,
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        checkedAt: "2026-08-18T00:00:00.000Z",
        models: [{ slug: "openai/gpt-5.4", name: "GPT 5.4", isCustom: false, capabilities: null }],
        slashCommands: [],
        skills: [],
      },
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unauthenticated" },
        checkedAt: "2026-08-18T00:00:00.000Z",
        models: [{ slug: "gpt-5.6-sol", name: "GPT 5.6", isCustom: false, capabilities: null }],
        slashCommands: [],
        skills: [],
      },
    ]);
    expect(candidates.every((candidate) => candidate.ready === false)).toBe(true);
  });
});

describe("resolveMtModelForTurn", () => {
  it("returns null for an ordinary model selection", () => {
    expect(
      resolveMtModelForTurn({
        stickySelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
        prompt: "hello",
        providers: [],
      }),
    ).toBeNull();
  });
});
