import { CommandId, ComputerTaskError, MessageId, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ComputerTaskBroker from "../../ComputerTaskBroker.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { resolveComputer } from "./resolve.ts";
import { ComputerToolkit } from "./tools.ts";

const isComputerTaskError = Schema.is(ComputerTaskError);
const TITLE_MAX = 80;

function threadTitle(preferred: string | undefined, message: string, sourceLabel: string): string {
  const fromPreferred = preferred?.trim();
  if (fromPreferred && fromPreferred.length > 0) {
    return fromPreferred.slice(0, TITLE_MAX).trimEnd();
  }
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length > 0) return firstLine.slice(0, TITLE_MAX).trimEnd();
  return `Task from ${sourceLabel}`.slice(0, TITLE_MAX).trimEnd();
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
  threads: ThreadManagementService.ThreadManagementServiceShape,
  threadId: ThreadId,
) {
  const thread = yield* threads.getThreadShell(threadId).pipe(
    Effect.mapError(
      (cause) =>
        new ComputerTaskError({
          code: "query_failed",
          detail: "T3 could not read the current thread.",
          cause,
        }),
    ),
  );
  return Option.filter(Option.fromNullishOr(thread), ({ archivedAt }) => archivedAt === null);
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
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const source = yield* readActiveThread(threads, invocation.threadId);
    if (Option.isNone(source)) {
      return yield* new ComputerTaskError({
        code: "source_unavailable",
        detail: "The invoking T3 thread is no longer active.",
      });
    }

    const projects = yield* ProjectStore.ProjectStoreV2;
    const sourceProject = yield* projects.get(source.value.projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.mapError(
        (cause) =>
          new ComputerTaskError({
            code: "query_failed",
            detail: "T3 could not read the current project catalog.",
            cause,
          }),
      ),
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
      const dispatchFailed = (cause: unknown) =>
        new ComputerTaskError({
          code: "dispatch_failed",
          detail: "T3 could not start a thread on this computer.",
          cause,
        });
      const [commandUuid, threadUuid, messageUuid] = yield* Effect.all([
        crypto.randomUUIDv4,
        crypto.randomUUIDv4,
        crypto.randomUUIDv4,
      ]).pipe(Effect.mapError(dispatchFailed));
      const threadId = ThreadId.make(threadUuid);
      yield* threads
        .dispatch({
          type: "thread.create",
          createdBy: "agent",
          creationSource: "mcp",
          commandId: CommandId.make(`mcp:computer-send:${commandUuid}:create`),
          threadId,
          projectId: source.value.projectId,
          title,
          modelSelection: source.value.modelSelection,
          runtimeMode: source.value.runtimeMode,
          interactionMode: source.value.interactionMode,
          branch: null,
          worktreePath: null,
        })
        .pipe(Effect.mapError(dispatchFailed));
      yield* threads
        .dispatch({
          type: "message.dispatch",
          createdBy: "agent",
          creationSource: "mcp",
          commandId: CommandId.make(`mcp:computer-send:${commandUuid}`),
          threadId,
          senderThreadId: source.value.id,
          messageId: MessageId.make(messageUuid),
          text: message,
          attachments: [],
          ...(input.title === undefined ? { titleSeed: title } : {}),
          modelSelection: source.value.modelSelection,
          dispatchMode: { type: "start_immediately" },
        })
        .pipe(Effect.mapError(dispatchFailed));
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
