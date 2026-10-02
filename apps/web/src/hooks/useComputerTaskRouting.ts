import {
  chooseTaskEnvironment,
  extractMentionedPaths,
  type TaskPlatform,
  type TaskRoutingDecision,
} from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

/** A machine that may take a computer-wide thread, as the composer sees it. */
export interface ComputerTaskCandidate {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly platform: TaskPlatform | null;
  readonly weight: number;
  readonly supportsPathCheck: boolean;
}

const ROUTING_DEADLINE_MS = 6_000;

function withDeadline<T>(promise: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => resolve(null), ROUTING_DEADLINE_MS);
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      () => {
        globalThis.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Asks every candidate for fresh load and for the folders the prompt
 * mentions, then picks where the task should run. Runs once per send, so
 * idle composers never poll other machines.
 */
export function useComputerTaskRouting() {
  const readHostResources = useAtomCommand(serverEnvironment.readHostResources, {
    reportFailure: false,
  });
  const checkHostPaths = useAtomCommand(serverEnvironment.checkHostPaths, {
    reportFailure: false,
  });

  return useCallback(
    async (input: {
      readonly prompt: string;
      readonly candidates: readonly ComputerTaskCandidate[];
      readonly platformOverride: TaskPlatform | null;
    }): Promise<TaskRoutingDecision> => {
      const mentionedPaths = extractMentionedPaths(input.prompt);
      const candidates = await Promise.all(
        input.candidates.map(async (candidate) => {
          const [resources, paths] = await Promise.all([
            withDeadline(readHostResources({ environmentId: candidate.environmentId, input: {} })),
            mentionedPaths.length > 0 && candidate.supportsPathCheck
              ? withDeadline(
                  checkHostPaths({
                    environmentId: candidate.environmentId,
                    input: { paths: mentionedPaths },
                  }),
                )
              : Promise.resolve(null),
          ]);
          return {
            environmentId: candidate.environmentId,
            label: candidate.label,
            platform: candidate.platform,
            weight: candidate.weight,
            resources: resources?._tag === "Success" ? resources.value : null,
            receivedAt: Date.now(),
            existingPaths:
              paths?._tag === "Success"
                ? new Set(paths.value.existing)
                : mentionedPaths.length === 0
                  ? new Set<string>()
                  : null,
          };
        }),
      );
      return chooseTaskEnvironment({
        prompt: input.prompt,
        candidates,
        mentionedPaths,
        platformOverride: input.platformOverride,
        now: Date.now(),
      });
    },
    [checkHostPaths, readHostResources],
  );
}
