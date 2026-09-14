import {
  WS_METHODS,
  type EnvironmentId,
  type SourceControlCloneRepositoryInput,
  type SourceControlPublishRepositoryInput,
  type SourceControlSshPasswordPromptRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  createRuntimeCommand,
  runInEnvironment,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { config as environmentConfig, request, runStream } from "../rpc/client.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";
import { invalidateCachedVcsRefs } from "./vcsRefInvalidation.ts";
import { consumeSshPromptedOperation } from "./sshPasswordPrompts.ts";

export function createSourceControlEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | EnvironmentCacheStore | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  return {
    discovery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:source-control-discovery",
      tag: WS_METHODS.serverDiscoverSourceControl,
    }),
    repository: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:source-control:repository",
      tag: WS_METHODS.sourceControlLookupRepository,
    }),
    cloneRepository: createRuntimeCommand(runtime, {
      label: "environment-data:source-control:clone-repository",
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
      execute: (target: {
        readonly environmentId: EnvironmentId;
        readonly input: SourceControlCloneRepositoryInput;
        readonly onSshPasswordPrompt?: (
          request: SourceControlSshPasswordPromptRequest,
        ) => Promise<string | null>;
      }) =>
        runInEnvironment(
          target.environmentId,
          Effect.gen(function* () {
            const onSshPasswordPrompt = target.onSshPasswordPrompt;
            if (onSshPasswordPrompt === undefined) {
              return yield* request(WS_METHODS.sourceControlCloneRepository, target.input);
            }
            const serverConfig = yield* environmentConfig;
            if (serverConfig.environment.capabilities.sourceControlSshPasswordPrompts !== true) {
              return yield* request(WS_METHODS.sourceControlCloneRepository, target.input);
            }
            return yield* consumeSshPromptedOperation(
              target.environmentId,
              "Repository cloning",
              runStream(WS_METHODS.sourceControlCloneRepositoryWithPrompts, target.input),
              onSshPasswordPrompt,
            );
          }),
        ),
    }),
    // Clone-backed project creation. The RPC returns once the project exists
    // and the clone runs in the background; `projectClones` carries progress.
    startProjectClone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:project-clone-start",
      tag: WS_METHODS.projectCloneStart,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    // Cancel and retry share the start queue so a double click cannot race
    // two actions against the same clone.
    cancelProjectClone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:project-clone-cancel",
      tag: WS_METHODS.projectCloneCancel,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    retryProjectClone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:project-clone-retry",
      tag: WS_METHODS.projectCloneRetry,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    // Every clone the environment tracks. Empty until a clone starts; a
    // finished clone drops out after a grace period, a failed one stays.
    projectClones: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:source-control:project-clones",
      tag: WS_METHODS.subscribeProjectClones,
    }),
    publishRepository: createRuntimeCommand(runtime, {
      label: "environment-data:source-control:publish-repository",
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      execute: (
        target: {
          readonly environmentId: EnvironmentId;
          readonly input: SourceControlPublishRepositoryInput;
          readonly onSshPasswordPrompt?: (
            request: SourceControlSshPasswordPromptRequest,
          ) => Promise<string | null>;
        },
        registry,
      ) =>
        runInEnvironment(
          target.environmentId,
          Effect.gen(function* () {
            const onSshPasswordPrompt = target.onSshPasswordPrompt;
            if (onSshPasswordPrompt === undefined) {
              return yield* request(WS_METHODS.sourceControlPublishRepository, target.input);
            }

            const serverConfig = yield* environmentConfig;
            if (serverConfig.environment.capabilities.sourceControlSshPasswordPrompts !== true) {
              return yield* request(WS_METHODS.sourceControlPublishRepository, target.input);
            }

            return yield* consumeSshPromptedOperation(
              target.environmentId,
              "Repository publishing",
              runStream(WS_METHODS.sourceControlPublishRepositoryWithPrompts, target.input),
              onSshPasswordPrompt,
            );
          }),
        ).pipe(
          Effect.ensuring(
            invalidateCachedVcsRefs(registry, {
              environmentId: target.environmentId,
              cwd: target.input.cwd,
            }),
          ),
        ),
    }),
  };
}
