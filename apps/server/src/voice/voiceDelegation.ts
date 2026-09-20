import { randomUUID } from "node:crypto";
import { CommandId, MessageId, VoiceApiError, type ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

/** Only the two orchestration entry points a spoken request needs. */
export type VoiceDelegationEngine = Pick<
  OrchestrationEngineShape,
  "dispatch" | "subscribeDomainEvents"
>;
export type VoiceDelegationQuery = Pick<ProjectionSnapshotQueryShape, "getThreadDetailById">;

/**
 * Run one spoken request as a normal turn in `threadId` and resolve with the
 * text the selected agent produced, so voice never becomes a second way to
 * reach a provider.
 */
export const delegateVoiceRequest = (
  engine: VoiceDelegationEngine,
  query: VoiceDelegationQuery,
  threadId: ThreadId,
  prompt: string,
) =>
  Effect.gen(function* () {
    const found = yield* query.getThreadDetailById(threadId);
    if (Option.isNone(found) || found.value.archivedAt !== null) {
      return yield* Effect.fail(
        new VoiceApiError({
          reason: "upstream_unavailable",
          message: "Open an existing, active MT Code task before starting voice.",
        }),
      );
    }
    const thread = found.value;
    if (thread.session?.status === "running" || thread.session?.status === "starting") {
      return yield* Effect.fail(
        new VoiceApiError({
          reason: "upstream_unavailable",
          message:
            "The selected agent is already working. Wait for its answer before sending another voice request.",
        }),
      );
    }
    // Acquire before dispatch so even an immediate provider answer cannot be lost.
    const events = yield* engine.subscribeDomainEvents;
    const now = DateTime.formatIso(yield* DateTime.now);
    const receipt = yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`voice:${randomUUID()}`),
      threadId,
      message: {
        messageId: MessageId.make(randomUUID()),
        role: "user",
        text: prompt,
        attachments: [],
      },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: now,
    });
    let started = false;
    let turnId: string | null = null;
    // Keyed by turn: a provider can still be flushing the previous turn's
    // messages when this one starts, and voice must never read those out.
    const messages = new Map<string, Map<string, string>>();
    const answer = yield* events.pipe(
      Stream.filter((event) => event.aggregateId === threadId && event.sequence > receipt.sequence),
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          if (event.type === "thread.message-sent" && event.payload.role === "assistant") {
            const turn = event.payload.turnId ?? "";
            const turnMessages = messages.get(turn) ?? new Map<string, string>();
            // A streamed message ends with an empty-text event that only marks
            // the message final; the body came on the events before it.
            if (event.payload.text.length > 0 || !turnMessages.has(event.payload.messageId)) {
              turnMessages.set(event.payload.messageId, event.payload.text);
            }
            messages.set(turn, turnMessages);
          }
          if (event.type !== "thread.session-set") return Option.none<string>();
          const session = event.payload.session;
          if (session.status === "running") {
            started = true;
            turnId = session.activeTurnId;
          }
          if (
            session.status === "error" ||
            session.status === "interrupted" ||
            session.status === "stopped"
          ) {
            return yield* Effect.fail(
              new VoiceApiError({
                reason: "upstream_unavailable",
                message:
                  session.lastError ?? "The selected agent's turn stopped before completing.",
              }),
            );
          }
          // "idle" and "ready" both settle a turn as completed (see the projector).
          if (
            started &&
            (session.status === "ready" || session.status === "idle") &&
            session.activeTurnId === null
          ) {
            if (session.lastError)
              return yield* Effect.fail(
                new VoiceApiError({ reason: "upstream_unavailable", message: session.lastError }),
              );
            const answered = messages.get(turnId ?? "") ?? messages.get("");
            return Option.some(
              [...(answered?.values() ?? [])].join("\n\n") ||
                "The agent completed without a text response. Check the task for results.",
            );
          }
          return Option.none<string>();
        }),
      ),
      Stream.filter(Option.isSome),
      Stream.map((value) => value.value),
      Stream.runHead,
    );
    return Option.getOrElse(answer, () => "The agent connection ended before a result arrived.");
  }).pipe(Effect.scoped, Effect.timeout("10 minutes"));
