import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import {
  classifyMtTurn,
  mergeMtTurnClassifications,
  parseMtModelRouteMode,
  parseMtTurnClassification,
  routeMtModel,
} from "./mtModelRouter.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const cursor = ProviderDriverKind.make("cursor");
const grok = ProviderDriverKind.make("grok");

function candidate(
  driver: ProviderDriverKind,
  model: string,
  usedPercent?: number,
): {
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  model: string;
  ready: boolean;
  usedPercent?: number;
} {
  return {
    instanceId: ProviderInstanceId.make(String(driver)),
    driverKind: driver,
    model,
    ready: true,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
  };
}

describe("classifyMtTurn", () => {
  it("treats typos and git chores as cheap routine work", () => {
    expect(classifyMtTurn({ prompt: "fix typo in README" }).taskKind).toBe("routine");
    expect(classifyMtTurn({ prompt: "write a commit message and push" }).taskKind).toBe("git");
    expect(classifyMtTurn({ prompt: "fix typo" }).difficulty).toBeLessThan(0.3);
  });

  it("escalates debugging, planning, and architecture", () => {
    expect(classifyMtTurn({ prompt: "this crash has a stack trace in production" }).taskKind).toBe(
      "debugging",
    );
    expect(
      classifyMtTurn({ prompt: "plan the auth migration", interactionMode: "plan" }).taskKind,
    ).toBe("planning");
    const architecture = classifyMtTurn({
      prompt: "refactor the billing service into a distributed multi-tenant design",
    });
    expect(architecture.taskKind).toBe("architecture");
    expect(architecture.difficulty).toBeGreaterThan(0.5);
  });
});

describe("routeMtModel", () => {
  const pool = [
    candidate(cursor, "auto", 20),
    candidate(grok, "grok-build", 10),
    candidate(claude, "claude-sonnet-5", 30),
    candidate(claude, "claude-opus-5", 30),
    candidate(codex, "gpt-5.6-sol", 15),
    candidate(codex, "gpt-5.6-luna", 15),
  ];

  it("sends cheap chores to a price-efficient model in cost mode", () => {
    const decision = routeMtModel({
      classification: classifyMtTurn({ prompt: "fix a typo in the changelog" }),
      mode: "cost",
      candidates: pool,
    });
    expect(decision?.model).toMatch(/auto|grok|luna|composer/i);
    expect(decision?.reason).toContain("MT Auto →");
  });

  it("sends hard architecture work to a frontier model in intelligence mode", () => {
    const decision = routeMtModel({
      classification: classifyMtTurn({
        prompt: "refactor the billing service into a distributed multi-tenant design",
      }),
      mode: "intelligence",
      candidates: pool,
    });
    expect(["claude-opus-5", "gpt-5.6-sol"]).toContain(decision?.model);
  });

  it("stays on the live session provider when that instance still has quota", () => {
    const decision = routeMtModel({
      classification: classifyMtTurn({ prompt: "implement the remaining API handlers" }),
      mode: "balance",
      candidates: pool,
      preferredInstanceId: ProviderInstanceId.make("claudeAgent"),
    });
    expect(decision?.instanceId).toBe("claudeAgent");
    expect(decision?.reason).toContain("kept session");
  });

  it("labels a Cloudflare classification in the route reason", () => {
    const decision = routeMtModel({
      classification: {
        difficulty: 0.85,
        taskKind: "architecture",
        source: "cloudflare",
      },
      mode: "intelligence",
      candidates: pool,
    });
    expect(decision?.reason).toContain("cloudflare");
  });

  it("leaves an exhausted provider when another ready model exists", () => {
    const decision = routeMtModel({
      classification: classifyMtTurn({ prompt: "implement the remaining API handlers" }),
      mode: "balance",
      candidates: [candidate(claude, "claude-sonnet-5", 98), candidate(codex, "gpt-5.6-sol", 12)],
      preferredInstanceId: ProviderInstanceId.make("claudeAgent"),
    });
    expect(decision?.instanceId).toBe("codex");
  });

  it("returns null when nothing is ready", () => {
    expect(
      routeMtModel({
        classification: classifyMtTurn({ prompt: "hello" }),
        candidates: [{ ...candidate(claude, "claude-sonnet-5"), ready: false }],
      }),
    ).toBeNull();
  });
});

describe("parseMtModelRouteMode", () => {
  it("defaults to balance and accepts the three Auto-style modes", () => {
    expect(parseMtModelRouteMode(undefined)).toBe("balance");
    expect(parseMtModelRouteMode([{ id: "routeMode", value: "intelligence" }])).toBe(
      "intelligence",
    );
    expect(parseMtModelRouteMode([{ id: "routeMode", value: "nope" }])).toBe("balance");
  });
});

describe("parseMtTurnClassification", () => {
  it("accepts a JSON body and a Workers AI response wrapper", () => {
    expect(parseMtTurnClassification({ difficulty: 0.8, taskKind: "architecture" })).toEqual({
      difficulty: 0.8,
      taskKind: "architecture",
      source: "cloudflare",
    });
    expect(
      parseMtTurnClassification({
        response: 'Here you go\n{"difficulty":0.2,"taskKind":"routine"}\n',
      }),
    ).toMatchObject({ difficulty: 0.2, taskKind: "routine" });
  });

  it("rejects unknown task kinds", () => {
    expect(parseMtTurnClassification({ difficulty: 0.5, taskKind: "poetry" })).toBeNull();
  });
});

describe("mergeMtTurnClassifications", () => {
  it("keeps a strong local task kind when Cloudflare dumps implementation", () => {
    const merged = mergeMtTurnClassifications(
      classifyMtTurn({ prompt: "fix a typo in the changelog" }),
      { difficulty: 0, taskKind: "implementation", source: "cloudflare" },
    );
    expect(merged.taskKind).toBe("routine");
    expect(merged.source).toBe("local");
  });

  it("keeps a strong local task kind when Cloudflare guesses a different kind", () => {
    const merged = mergeMtTurnClassifications(
      classifyMtTurn({ prompt: "fix a typo in the changelog" }),
      { difficulty: 0, taskKind: "debugging", source: "cloudflare" },
    );
    expect(merged.taskKind).toBe("routine");
    expect(merged.source).toBe("local");
  });
});
