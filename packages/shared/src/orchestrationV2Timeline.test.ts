import { MessageId, NodeId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createOrchestrationV2TurnItemVisibility,
  interruptedRunContinuationMessageId,
  isInterruptedRunContinuationMessageId,
  isOrchestrationV2TurnItemVisible,
} from "./orchestrationV2Timeline.ts";

const runId = RunId.make("run:timeline-visibility");
const nodeId = NodeId.make("node:timeline-visibility");

describe.each([
  ["point", isOrchestrationV2TurnItemVisible],
  [
    "indexed",
    (input: Parameters<typeof isOrchestrationV2TurnItemVisible>[0]) =>
      createOrchestrationV2TurnItemVisibility(input)(input.item),
  ],
] as const)("%s timeline visibility", (_, isVisible) => {
  it("hides unpaired interruption results from superseded attempts", () => {
    expect(
      isVisible({
        item: { type: "run_interrupt_result", runId, nodeId },
        runs: [{ id: runId, status: "running" }],
        attempts: [{ runId, rootNodeId: nodeId, status: "superseded" }],
        items: [{ type: "run_interrupt_result", runId, nodeId }],
      }),
    ).toBe(false);
  });

  it("keeps paired interruption results from superseded attempts", () => {
    expect(
      isVisible({
        item: { type: "run_interrupt_result", runId, nodeId },
        runs: [{ id: runId, status: "running" }],
        attempts: [{ runId, rootNodeId: nodeId, status: "superseded" }],
        items: [
          { type: "run_interrupt_request", runId, nodeId },
          { type: "run_interrupt_result", runId, nodeId },
        ],
      }),
    ).toBe(true);
  });

  it("keeps interruption results from terminal attempts without a request", () => {
    expect(
      isVisible({
        item: { type: "run_interrupt_result", runId, nodeId },
        runs: [{ id: runId, status: "interrupted" }],
        attempts: [{ runId, rootNodeId: nodeId, status: "interrupted" }],
        items: [{ type: "run_interrupt_result", runId, nodeId }],
      }),
    ).toBe(true);
  });

  it("keeps interruption results from terminal attempts with a request", () => {
    expect(
      isVisible({
        item: { type: "run_interrupt_result", runId, nodeId },
        runs: [{ id: runId, status: "interrupted" }],
        attempts: [{ runId, rootNodeId: nodeId, status: "interrupted" }],
        items: [
          { type: "run_interrupt_request", runId, nodeId },
          { type: "run_interrupt_result", runId, nodeId },
        ],
      }),
    ).toBe(true);
  });

  it("hides queued user messages once their run is cancelled", () => {
    expect(
      isVisible({
        item: { type: "user_message", inputIntent: "queued_turn", runId, nodeId },
        runs: [{ id: runId, status: "cancelled" }],
        attempts: [],
        items: [{ type: "user_message", inputIntent: "queued_turn", runId, nodeId }],
      }),
    ).toBe(false);
  });

  it("keeps queued user messages while their run is queued", () => {
    expect(
      isVisible({
        item: { type: "user_message", inputIntent: "queued_turn", runId, nodeId },
        runs: [{ id: runId, status: "queued" }],
        attempts: [],
        items: [{ type: "user_message", inputIntent: "queued_turn", runId, nodeId }],
      }),
    ).toBe(true);
  });

  it("keeps non-queued user messages on cancelled runs", () => {
    expect(
      isVisible({
        item: { type: "user_message", inputIntent: "turn_start", runId, nodeId },
        runs: [{ id: runId, status: "cancelled" }],
        attempts: [],
        items: [{ type: "user_message", inputIntent: "turn_start", runId, nodeId }],
      }),
    ).toBe(true);
  });

  it("hides the one-tap Continue message but not the user's own messages", () => {
    const continuation = {
      type: "user_message" as const,
      inputIntent: "turn_start" as const,
      messageId: interruptedRunContinuationMessageId(RunId.make("run:timeline-visibility:stopped")),
      runId,
      nodeId,
    };
    const typed = { ...continuation, messageId: MessageId.make("message:timeline-visibility") };
    const context = {
      runs: [{ id: runId, status: "completed" as const }],
      attempts: [],
      items: [typed, continuation],
    };
    expect(isVisible({ ...context, item: continuation })).toBe(false);
    expect(isVisible({ ...context, item: typed })).toBe(true);
  });

  it("does not hide an interruption because another attempt was superseded", () => {
    expect(
      isVisible({
        item: { type: "run_interrupt_result", runId, nodeId },
        runs: [{ id: runId, status: "interrupted" }],
        attempts: [
          {
            runId,
            rootNodeId: NodeId.make("node:timeline-visibility:older"),
            status: "superseded",
          },
          { runId, rootNodeId: nodeId, status: "interrupted" },
        ],
        items: [{ type: "run_interrupt_result", runId, nodeId }],
      }),
    ).toBe(true);
  });
});

describe("interruptedRunContinuationMessageId", () => {
  it("is one id per stopped run, recognised by its prefix", () => {
    const stopped = RunId.make("run:timeline-visibility:stopped");
    expect(interruptedRunContinuationMessageId(stopped)).toBe(
      interruptedRunContinuationMessageId(stopped),
    );
    expect(interruptedRunContinuationMessageId(stopped)).not.toBe(
      interruptedRunContinuationMessageId(RunId.make("run:timeline-visibility:other")),
    );
    expect(
      isInterruptedRunContinuationMessageId(interruptedRunContinuationMessageId(stopped)),
    ).toBe(true);
    expect(isInterruptedRunContinuationMessageId("message:restart-continuation:run")).toBe(false);
  });
});
