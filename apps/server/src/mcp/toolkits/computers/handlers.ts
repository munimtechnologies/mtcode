import {
  CommandId,
  ComputerTaskError,
  MessageId,
  ThreadId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ComputerTaskBroker from "../../ComputerTaskBroker.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveComputer } from "./resolve.ts";
import { ComputerToolkit } from "./tools.ts";

const isComputerTaskError = Schema.is(ComputerTaskError);
const TITLE_MAX = 80;

function threadTitle(preferred: string | undefined, message: string, sourceLabel: string): string {
  const fromPreferred = preferred?.trim();
  if (fromPreferred && fromPreferred.length > 0) return fromPreferred.slice(0, TITLE_MAX);
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length > 0) return firstLine.slice(0, TITLE_MAX);
  return `Task from ${sourceLabel}`.slice(0, TITLE_MAX);
}

export function formatComputerTaskMessage(input: {
  readonly sourceLabel: string;
  readonly sourceEnvironmentId: string;
  readonly sourceThreadId: string;
  readonly message: string;
}): string {
  return [
    "[T3 computer task — server-authored]",
    `From: ${input.sourceLabel} (${input.sourceEnvironmentId})`,
    `Source thread: ${input.sourceThreadId}`,
    `Reply with computer_send to ${input.sourceLabel} only if useful.`,
    "",
    input.message,
  ].join("\n");
}

const readActiveThread = Effect.fn("ComputerTask.readActiveThread")(function* (
  query: ProjectionSnapshotQuery["Service"],
  threadId: OrchestrationThreadShell["id"],
) {
  const thread = yield* query.getThreadShellById(threadId).pipe(
    Effect.mapError(
      (cause) =>
        new ComputerTaskError({
          code: "query_failed",
          detail: "T3 could not read the current thread.",
          cause,
        }),
    ),
  );
  return Option.filter(thread, ({ archivedAt }) => archivedAt === null);
});

const handlers = {
  computer_list: Effect.fn("ComputerTask.computerList")(function* () {
    const broker = yield* ComputerTaskBroker.ComputerTaskBroker;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const descriptor = yield* environment.getDescriptor;
    const computers = yield* broker.list(descriptor);
    return {
      thisEnvironmentId: descriptor.environmentId,
      computers,
    };
  }),
  computer_send: Effect.fn("ComputerTask.computerSend")(function* (input) {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const query = yield* ProjectionSnapshotQuery;
    const source = yield* readActiveThread(query, invocation.threadId);
    if (Option.isNone(source)) {
      return yield* new ComputerTaskError({
        code: "source_unavailable",
        detail: "The invoking T3 thread is no longer active.",
      });
    }

    const snapshot = yield* query.getShellSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new ComputerTaskError({
            code: "query_failed",
            detail: "T3 could not read the current project catalog.",
            cause,
          }),
      ),
    );
    const sourceProject = snapshot.projects.find(
      (project) => project.id === source.value.projectId,
    );
    if (!sourceProject) {
      return yield* new ComputerTaskError({
        code: "source_unavailable",
        detail: "The invoking T3 thread's project is no longer available.",
      });
    }

    const broker = yield* ComputerTaskBroker.ComputerTaskBroker;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const descriptor = yield* environment.getDescriptor;
    const computers = yield* broker.list(descriptor);
    const resolved = resolveComputer(input.computer, computers);
    if (isComputerTaskError(resolved)) return yield* resolved;

    const title = threadTitle(input.title, input.message, descriptor.label);
    const message = formatComputerTaskMessage({
      sourceLabel: descriptor.label,
      sourceEnvironmentId: descriptor.environmentId,
      sourceThreadId: source.value.id,
      message: input.message,
    });

    if (resolved.thisMachine) {
      const crypto = yield* Crypto.Crypto;
      const engine = yield* OrchestrationEngineService;
      const [commandUuid, threadUuid, messageUuid, createdAt] = yield* Effect.all([
        crypto.randomUUIDv4,
        crypto.randomUUIDv4,
        crypto.randomUUIDv4,
        Effect.map(DateTime.now, DateTime.formatIso),
      ]).pipe(
        Effect.mapError(
          (cause) =>
            new ComputerTaskError({
              code: "dispatch_failed",
              detail: "T3 could not start a thread on this computer.",
              cause,
            }),
        ),
      );
      const threadId = ThreadId.make(threadUuid);
      const accepted = yield* engine
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`mcp:computer-send:${commandUuid}`),
          threadId,
          message: {
            messageId: MessageId.make(messageUuid),
            role: "user",
            text: message,
            attachments: [],
          },
          modelSelection: source.value.modelSelection,
          titleSeed: title,
          runtimeMode: source.value.runtimeMode,
          interactionMode: source.value.interactionMode,
          bootstrap: {
            createThread: {
              projectId: source.value.projectId,
              title,
              modelSelection: source.value.modelSelection,
              runtimeMode: source.value.runtimeMode,
              interactionMode: source.value.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ComputerTaskError({
                code: "dispatch_failed",
                detail: "T3 could not start a thread on this computer.",
                cause,
              }),
          ),
        );
      void accepted;
      return {
        environmentId: descriptor.environmentId,
        threadId,
        projectId: source.value.projectId,
      };
    }

    return yield* broker.send({
      computer: {
        environmentId: resolved.environmentId,
        label: resolved.label,
        kind: resolved.kind,
        os: resolved.os,
        connected: resolved.connected,
        ...(resolved.sshTarget === undefined ? {} : { sshTarget: resolved.sshTarget }),
      },
      message,
      title,
      source: {
        environmentId: descriptor.environmentId,
        threadId: source.value.id,
        label: descriptor.label,
        projectTitle: sourceProject.title,
        projectWorkspaceRoot: sourceProject.workspaceRoot,
      },
      projectHint: input.project ?? null,
      modelSelection: source.value.modelSelection,
      runtimeMode: source.value.runtimeMode,
      interactionMode: source.value.interactionMode,
    });
  }),
} satisfies Parameters<typeof ComputerToolkit.toLayer>[0];

export const ComputerToolkitHandlersLive = ComputerToolkit.toLayer(handlers);

export const __testing = {
  formatComputerTaskMessage,
  threadTitle,
};
