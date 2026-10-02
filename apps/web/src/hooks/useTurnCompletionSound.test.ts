import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

import { makeThreadFixture } from "../test-fixtures";
import { detectNewTurnCompletions, shouldPlayTurnCompletionChime } from "./useTurnCompletionSound";

const envId = EnvironmentId.make("environment-local");
const projId = ProjectId.make("project-1");
const providerInstanceId = ProviderInstanceId.make("provider-1");

function createMockThread(
  id: string,
  overrides?: Partial<EnvironmentThreadShell>,
): EnvironmentThreadShell {
  return makeThreadFixture({
    environmentId: envId,
    id: ThreadId.make(id),
    projectId: projId,
    title: `Thread ${id}`,
    modelSelection: { instanceId: providerInstanceId, model: "test-model" },
    createdAt: "2026-08-15T07:00:00.000Z",
    updatedAt: "2026-08-15T07:00:00.000Z",
    ...overrides,
  });
}

function runtime(
  status: NonNullable<EnvironmentThreadShell["runtime"]>["status"],
  activeRunId: RunId | null,
  updatedAt: string,
): NonNullable<EnvironmentThreadShell["runtime"]> {
  return {
    status,
    activeRunId,
    providerInstanceId,
    providerName: null,
    lastError: null,
    updatedAt,
  };
}

function completedRun(
  runId: string,
  requestedAt: string,
  completedAt: string,
): NonNullable<EnvironmentThreadShell["latestRun"]> {
  return {
    runId: RunId.make(runId),
    status: "completed",
    requestedAt,
    startedAt: requestedAt,
    completedAt,
    assistantMessageId: null,
  };
}

describe("detectNewTurnCompletions", () => {
  it("does not trigger chime on initial snapshot or environment hydration of settled threads", () => {
    const thread = createMockThread("thread-1", {
      runtime: runtime("idle", null, "2026-08-15T07:02:00.000Z"),
      latestRun: completedRun("run-1", "2026-08-15T07:01:00.000Z", "2026-08-15T07:02:00.000Z"),
    });
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

    const result = detectNewTurnCompletions([thread], {});
    expect(result.hasNewCompletion).toBe(false);
    expect(result.nextCompletions[key]).toBe("2026-08-15T07:02:00.000Z");
  });

  it("does not trigger chime while the latest run is still running", () => {
    const runId = RunId.make("run-1");
    const thread = createMockThread("thread-1", {
      runtime: runtime("running", runId, "2026-08-15T07:01:30.000Z"),
      latestRun: {
        runId,
        status: "running",
        requestedAt: "2026-08-15T07:01:00.000Z",
        startedAt: "2026-08-15T07:01:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

    const result = detectNewTurnCompletions([thread], {});
    expect(result.hasNewCompletion).toBe(false);
    expect(result.nextCompletions[key]).toBe("running");
  });

  it("triggers chime when a running thread settles and completes", () => {
    const thread = createMockThread("thread-1", {
      runtime: runtime("idle", null, "2026-08-15T07:02:00.000Z"),
      latestRun: completedRun("run-1", "2026-08-15T07:01:00.000Z", "2026-08-15T07:02:00.000Z"),
    });
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const previous = { [key]: "running" };

    const result = detectNewTurnCompletions([thread], previous);
    expect(result.hasNewCompletion).toBe(true);
    expect(result.completedThreadKeys).toEqual([key]);
    expect(result.nextCompletions[key]).toBe("2026-08-15T07:02:00.000Z");
  });

  it("triggers chime when a previously completed thread completes a new run", () => {
    const thread = createMockThread("thread-1", {
      runtime: runtime("idle", null, "2026-08-15T07:06:00.000Z"),
      latestRun: completedRun("run-2", "2026-08-15T07:05:00.000Z", "2026-08-15T07:06:00.000Z"),
    });
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const previous = { [key]: "2026-08-15T07:02:00.000Z" };

    const result = detectNewTurnCompletions([thread], previous);
    expect(result.hasNewCompletion).toBe(true);
    expect(result.nextCompletions[key]).toBe("2026-08-15T07:06:00.000Z");
  });

  it("ignores unchanged completed threads on subsequent renders", () => {
    const thread = createMockThread("thread-1", {
      runtime: runtime("idle", null, "2026-08-15T07:06:00.000Z"),
      latestRun: completedRun("run-2", "2026-08-15T07:05:00.000Z", "2026-08-15T07:06:00.000Z"),
    });
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const previous = { [key]: "2026-08-15T07:06:00.000Z" };

    const result = detectNewTurnCompletions([thread], previous);
    expect(result.hasNewCompletion).toBe(false);
  });

  it("clears tracked state when thread is archived and does not chime on unarchiving an already-settled thread", () => {
    const archivedThread = createMockThread("thread-1", {
      archivedAt: "2026-08-15T07:04:00.000Z",
      runtime: runtime("idle", null, "2026-08-15T07:06:00.000Z"),
      latestRun: completedRun("run-2", "2026-08-15T07:05:00.000Z", "2026-08-15T07:06:00.000Z"),
    });
    const key = scopedThreadKey(scopeThreadRef(archivedThread.environmentId, archivedThread.id));
    const previous = { [key]: "running" };

    const archivedResult = detectNewTurnCompletions([archivedThread], previous);
    expect(archivedResult.hasNewCompletion).toBe(false);
    expect(archivedResult.nextCompletions[key]).toBeUndefined();

    const unarchivedThread = { ...archivedThread, archivedAt: null };
    const unarchivedResult = detectNewTurnCompletions(
      [unarchivedThread],
      archivedResult.nextCompletions,
    );
    expect(unarchivedResult.hasNewCompletion).toBe(false);
    expect(unarchivedResult.nextCompletions[key]).toBe("2026-08-15T07:06:00.000Z");
  });
});

describe("shouldPlayTurnCompletionChime", () => {
  it("stays quiet when the only completed thread is the one being viewed", () => {
    expect(shouldPlayTurnCompletionChime(["env:thread-1"], "env:thread-1")).toBe(false);
  });

  it("chimes when a background thread finishes, even if the viewed thread also finished", () => {
    expect(shouldPlayTurnCompletionChime(["env:thread-1", "env:thread-2"], "env:thread-1")).toBe(
      true,
    );
  });

  it("chimes when nothing is being viewed", () => {
    expect(shouldPlayTurnCompletionChime(["env:thread-1"], null)).toBe(true);
  });
});
