import { CommandId, MessageId, type OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { DEFAULT_THREAD_TITLE } from "../../../orchestration/threadTitles.ts";
import {
  THREAD_CREATE_MAX_WORKING_SIBLINGS,
  THREAD_RELAY_LIST_LIMIT,
  ThreadRelayError,
  ThreadRelayToolkit,
} from "./tools.ts";

function relayStatus(
  thread: OrchestrationThreadShell,
): "idle" | "working" | "monitoring" | "waiting" | "error" {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "waiting";
  if (thread.session?.status === "error") return "error";
  if (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.backgroundLiveness === "working"
  ) {
    return "working";
  }
  return thread.backgroundLiveness === "monitoring" ? "monitoring" : "idle";
}

const readActiveThread = Effect.fn("ThreadRelay.readActiveThread")(function* (
  query: ProjectionSnapshotQuery["Service"],
  threadId: OrchestrationThreadShell["id"],
) {
  const thread = yield* query.getThreadShellById(threadId).pipe(
    Effect.mapError(
      (cause) =>
        new ThreadRelayError({
          code: "query_failed",
          detail: "T3 could not read the current thread catalog.",
          cause,
        }),
    ),
  );
  return Option.filter(thread, ({ archivedAt }) => archivedAt === null);
});

const handlers = {
  thread_list: Effect.fn("ThreadRelay.threadList")(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const query = yield* ProjectionSnapshotQuery;
    const source = yield* readActiveThread(query, invocation.threadId);
    if (Option.isNone(source)) {
      return yield* new ThreadRelayError({
        code: "source_unavailable",
        detail: "The invoking T3 thread is no longer active.",
      });
    }

    const snapshot = yield* query.getShellSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new ThreadRelayError({
            code: "query_failed",
            detail: "T3 could not read the current thread catalog.",
            cause,
          }),
      ),
    );
    const peers = snapshot.threads
      .filter(
        (thread) =>
          thread.projectId === source.value.projectId &&
          thread.id !== invocation.threadId &&
          thread.archivedAt === null,
      )
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const threads = peers.slice(0, THREAD_RELAY_LIST_LIMIT).map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      status: relayStatus(thread),
      branch: thread.branch,
      workspace: thread.worktreePath === null ? ("shared" as const) : ("worktree" as const),
      updatedAt: thread.updatedAt,
    }));
    return {
      threads,
      truncated: peers.length > threads.length,
    };
  }),
  thread_send: Effect.fn("ThreadRelay.threadSend")(function* (input) {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (input.threadId === invocation.threadId) {
      return yield* new ThreadRelayError({
        code: "self_send",
        detail: "A T3 thread cannot send a message to itself.",
      });
    }

    const query = yield* ProjectionSnapshotQuery;
    const [source, target] = yield* Effect.all([
      readActiveThread(query, invocation.threadId),
      readActiveThread(query, input.threadId),
    ]);
    if (Option.isNone(source)) {
      return yield* new ThreadRelayError({
        code: "source_unavailable",
        detail: "The invoking T3 thread is no longer active.",
      });
    }
    if (Option.isNone(target)) {
      return yield* new ThreadRelayError({
        code: "target_not_found",
        detail: `No active T3 thread exists with id '${input.threadId}'.`,
      });
    }
    if (source.value.projectId !== target.value.projectId) {
      return yield* new ThreadRelayError({
        code: "cross_project",
        detail: "T3 threads can only message siblings in the same project.",
      });
    }

    const crypto = yield* Crypto.Crypto;
    const engine = yield* OrchestrationEngineService;
    const [commandUuid, messageUuid, createdAt] = yield* Effect.all([
      crypto.randomUUIDv4,
      crypto.randomUUIDv4,
      Effect.map(DateTime.now, DateTime.formatIso),
    ]).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadRelayError({
            code: "dispatch_failed",
            detail: "T3 could not durably accept the thread message.",
            cause,
          }),
      ),
    );
    const messageId = MessageId.make(messageUuid);
    const accepted = yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`mcp:thread-send:${commandUuid}`),
        threadId: target.value.id,
        message: {
          messageId,
          role: "user",
          text: input.message,
          attachments: [],
        },
        runtimeMode: target.value.runtimeMode,
        interactionMode: target.value.interactionMode,
        sourceThreadMessage: { threadId: source.value.id },
        createdAt,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadRelayError({
              code: "dispatch_failed",
              detail: "T3 could not durably accept the thread message.",
              cause,
            }),
        ),
      );
    return {
      messageId,
      targetThreadId: target.value.id,
      status: "accepted" as const,
      sequence: accepted.sequence,
    };
  }),
  thread_create: Effect.fn("ThreadRelay.threadCreate")(function* (input) {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const query = yield* ProjectionSnapshotQuery;
    const source = yield* readActiveThread(query, invocation.threadId);
    if (Option.isNone(source)) {
      return yield* new ThreadRelayError({
        code: "source_unavailable",
        detail: "The invoking T3 thread is no longer active.",
      });
    }

    const snapshot = yield* query.getShellSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new ThreadRelayError({
            code: "query_failed",
            detail: "T3 could not read the current thread catalog.",
            cause,
          }),
      ),
    );
    const workingSiblings = snapshot.threads.filter(
      (thread) =>
        thread.projectId === source.value.projectId &&
        thread.archivedAt === null &&
        relayStatus(thread) === "working",
    ).length;
    if (workingSiblings >= THREAD_CREATE_MAX_WORKING_SIBLINGS) {
      return yield* new ThreadRelayError({
        code: "spawn_limit",
        detail: `This project already has ${workingSiblings} threads actively working. Wait for some to finish before creating more.`,
      });
    }

    const crypto = yield* Crypto.Crypto;
    const engine = yield* OrchestrationEngineService;
    const [threadUuid, createUuid, turnUuid, messageUuid, createdAt] = yield* Effect.all([
      crypto.randomUUIDv4,
      crypto.randomUUIDv4,
      crypto.randomUUIDv4,
      crypto.randomUUIDv4,
      Effect.map(DateTime.now, DateTime.formatIso),
    ]).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadRelayError({
            code: "dispatch_failed",
            detail: "T3 could not durably create the thread.",
            cause,
          }),
      ),
    );
    const threadId = ThreadId.make(threadUuid);
    const messageId = MessageId.make(messageUuid);
    yield* engine
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(`mcp:thread-create:${createUuid}`),
        threadId,
        projectId: source.value.projectId,
        title: input.title ?? DEFAULT_THREAD_TITLE,
        modelSelection: source.value.modelSelection,
        runtimeMode: source.value.runtimeMode,
        interactionMode: source.value.interactionMode,
        branch: source.value.branch,
        worktreePath: source.value.worktreePath,
        createdAt,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadRelayError({
              code: "dispatch_failed",
              detail: "T3 could not durably create the thread.",
              cause,
            }),
        ),
      );
    const accepted = yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`mcp:thread-create-turn:${turnUuid}`),
        threadId,
        message: {
          messageId,
          role: "user",
          text: input.message,
          attachments: [],
        },
        runtimeMode: source.value.runtimeMode,
        interactionMode: source.value.interactionMode,
        sourceThreadMessage: { threadId: source.value.id },
        createdAt,
      })
      .pipe(
        // A created thread whose first turn never landed is unreachable dead
        // weight, so roll the creation back before surfacing the failure.
        Effect.onError(() =>
          engine
            .dispatch({
              type: "thread.delete",
              commandId: CommandId.make(`mcp:thread-create-cleanup:${turnUuid}`),
              threadId,
            })
            .pipe(Effect.ignore),
        ),
        Effect.mapError(
          (cause) =>
            new ThreadRelayError({
              code: "dispatch_failed",
              detail: "T3 could not durably start the new thread's first turn.",
              cause,
            }),
        ),
      );
    return {
      threadId,
      messageId,
      status: "accepted" as const,
      sequence: accepted.sequence,
    };
  }),
  thread_archive: Effect.fn("ThreadRelay.threadArchive")(function* (input) {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (input.threadId === invocation.threadId) {
      return yield* new ThreadRelayError({
        code: "self_archive",
        detail: "A T3 thread cannot archive itself.",
      });
    }

    const query = yield* ProjectionSnapshotQuery;
    const [source, target] = yield* Effect.all([
      readActiveThread(query, invocation.threadId),
      readActiveThread(query, input.threadId),
    ]);
    if (Option.isNone(source)) {
      return yield* new ThreadRelayError({
        code: "source_unavailable",
        detail: "The invoking T3 thread is no longer active.",
      });
    }
    if (Option.isNone(target)) {
      return yield* new ThreadRelayError({
        code: "target_not_found",
        detail: `No active T3 thread exists with id '${input.threadId}'.`,
      });
    }
    if (source.value.projectId !== target.value.projectId) {
      return yield* new ThreadRelayError({
        code: "cross_project",
        detail: "T3 threads can only archive siblings in the same project.",
      });
    }
    const status = relayStatus(target.value);
    if (status === "working" || status === "waiting") {
      return yield* new ThreadRelayError({
        code: "target_busy",
        detail: `Thread '${input.threadId}' is ${status} and cannot be archived until it settles.`,
      });
    }

    const crypto = yield* Crypto.Crypto;
    const engine = yield* OrchestrationEngineService;
    const commandUuid = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ThreadRelayError({
            code: "dispatch_failed",
            detail: "T3 could not durably archive the thread.",
            cause,
          }),
      ),
    );
    yield* engine
      .dispatch({
        type: "thread.archive",
        commandId: CommandId.make(`mcp:thread-archive:${commandUuid}`),
        threadId: target.value.id,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadRelayError({
              code: "dispatch_failed",
              detail: "T3 could not durably archive the thread.",
              cause,
            }),
        ),
      );
    return {
      threadId: target.value.id,
      status: "archived" as const,
    };
  }),
} satisfies Parameters<typeof ThreadRelayToolkit.toLayer>[0];

export const ThreadRelayToolkitHandlersLive = ThreadRelayToolkit.toLayer(handlers);

export const __testing = {
  relayStatus,
};
