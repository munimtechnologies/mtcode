import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMatches } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { playTurnCompletionSound } from "~/audio/turnChime";
import { useClientSettings } from "./useSettings";
import { useThreadShells } from "~/state/entities";
import { isLatestTurnSettled } from "~/session-logic";

export function detectNewTurnCompletions(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  previousCompletions: Readonly<Record<string, string>>,
): {
  readonly hasNewCompletion: boolean;
  readonly completedThreadKeys: readonly string[];
  readonly nextCompletions: Record<string, string>;
} {
  const nextCompletions: Record<string, string> = { ...previousCompletions };
  const completedThreadKeys: string[] = [];

  for (const thread of threads) {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (thread.archivedAt !== null) {
      delete nextCompletions[threadKey];
      continue;
    }
    const previousState = previousCompletions[threadKey];

    const isSettled =
      isLatestTurnSettled(thread.latestTurn, thread.session) &&
      thread.latestTurn?.state !== "running" &&
      Boolean(thread.latestTurn?.completedAt);

    if (!isSettled) {
      if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
        nextCompletions[threadKey] = "running";
      }
      continue;
    }

    const completedAt = thread.latestTurn?.completedAt;
    if (!completedAt) continue;

    if (previousState === undefined) {
      nextCompletions[threadKey] = completedAt;
      continue;
    }

    if (previousState !== completedAt) {
      nextCompletions[threadKey] = completedAt;
      completedThreadKeys.push(threadKey);
    }
  }

  return {
    hasNewCompletion: completedThreadKeys.length > 0,
    completedThreadKeys,
    nextCompletions,
  };
}

/** Chime for background finishes. The open thread already has the transcript. */
export function shouldPlayTurnCompletionChime(
  completedThreadKeys: readonly string[],
  viewedThreadKey: string | null,
): boolean {
  return completedThreadKeys.some((threadKey) => threadKey !== viewedThreadKey);
}

function useViewedThreadKey(): string | null {
  const matches = useMatches();
  for (const match of matches) {
    const params = match.params as { environmentId?: string; threadId?: string };
    if (params.environmentId && params.threadId) {
      return scopedThreadKey(
        scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId)),
      );
    }
  }
  return null;
}

export function useTurnCompletionSound(): void {
  const settings = useClientSettings();
  const threads = useThreadShells();
  const viewedThreadKey = useViewedThreadKey();
  const knownCompletionsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const { completedThreadKeys, nextCompletions } = detectNewTurnCompletions(
      threads,
      knownCompletionsRef.current,
    );
    knownCompletionsRef.current = nextCompletions;

    if (
      settings.soundNotificationsEnabled &&
      shouldPlayTurnCompletionChime(completedThreadKeys, viewedThreadKey)
    ) {
      playTurnCompletionSound();
    }
  }, [threads, settings.soundNotificationsEnabled, viewedThreadKey]);
}
