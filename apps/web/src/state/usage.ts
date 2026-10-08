/**
 * Multi-environment usage state.
 *
 * Connected environments answer the typed usage query. Connection state
 * determines whether a waiting query contributes to loading coverage, so one
 * unreachable machine can never hold the dashboard open.
 *
 * @module state/usage
 */
import { useAtomValue } from "@effect/atom-react";
import {
  AuthDiagnosticsReadScope,
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageBucket,
  type UsageSummary,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { needsCursorKeychainAccess, refreshUsage } from "@t3tools/client-runtime/state/usage";
import { resolveUsageAccess } from "@t3tools/client-runtime/state/usage-access";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import { environmentSession, readEnvironmentScope } from "./session";
import {
  getEnvironmentUsageLoadingState,
  type EnvironmentUsageOption,
} from "./usageEnvironmentScope";

export type { EnvironmentUsageOption } from "./usageEnvironmentScope";

export interface EnvironmentUsageStatus extends EnvironmentUsageOption {
  readonly isPending: boolean;
  readonly canReadDiagnostics: boolean;
  readonly isConnected: boolean;
  /**
   * A connected usage query failed, or this connection may not read usage.
   * Connection coverage uses `phase`.
   */
  readonly error: string | null;
  readonly summary: UsageSummary | null;
  readonly needsCursorKeychainAccess: boolean;
}

interface UsageAtomValue {
  readonly isCatalogReady: boolean;
  readonly options: readonly EnvironmentUsageOption[];
  readonly environments: readonly EnvironmentUsageStatus[];
}

interface UsageAtomKey {
  readonly input: UsageSummaryInput;
}

const usageByWindowAtom = Atom.family((key: string) =>
  Atom.make((get): UsageAtomValue => {
    const { input } = JSON.parse(key) as UsageAtomKey;
    const catalog = get(environmentCatalog.catalogValueAtom);
    const presentations = get(environmentPresentations.presentationsAtom);
    const options = Array.from(presentations, ([environmentId, presentation]) => ({
      environmentId,
      label: presentation.entry.target.label,
      phase: presentation.connection.phase,
    }));

    // Keep every environment subscribed while this time window is mounted. Filtering
    // only the view avoids evicting sibling usage caches when switching scopes.
    const environments: EnvironmentUsageStatus[] = [];
    for (const option of options) {
      const { environmentId } = option;
      const isConnected = option.phase === "connected";
      const connectionResult = get(environmentCatalog.stateAtom(environmentId));
      const sessionResult = get(environmentSession.sessionStateAtom(environmentId));
      const session = Option.getOrNull(AsyncResult.value(sessionResult));
      const access = resolveUsageAccess({
        connectionPhase: option.phase,
        session,
        hasSessionError: sessionResult._tag === "Failure",
      });
      if (!access.canReadDiagnostics) {
        // A session that has not arrived yet waits only through the first
        // connection attempt, like the usage query below, so a down machine
        // cannot hold the dashboard open.
        const awaitingSession = session === null && sessionResult._tag !== "Failure";
        const isPending = awaitingSession
          ? (option.phase === "available" && connectionResult.waiting) ||
            option.phase === "connecting" ||
            option.phase === "connected"
          : access.isPending;
        environments.push({
          ...option,
          isConnected,
          ...access,
          isPending,
          error: awaitingSession && isPending ? null : access.error,
          summary: null,
          needsCursorKeychainAccess: false,
        });
        continue;
      }
      // Keep reading the environment-scoped atom while disconnected so a prior
      // successful value remains visible. Wait through the first connection attempt,
      // then treat retries as terminal coverage so a down machine cannot block the UI.
      const result = get(serverEnvironment.usageSummary({ environmentId, input }));
      const summary = Option.getOrNull(AsyncResult.value(result));
      const failed = option.phase === "connected" && result._tag === "Failure";
      environments.push({
        ...option,
        isPending:
          (option.phase === "available" && connectionResult.waiting) ||
          option.phase === "connecting" ||
          (option.phase === "connected" && result.waiting),
        canReadDiagnostics: true,
        isConnected,
        error: failed ? "This environment could not report usage." : null,
        summary,
        needsCursorKeychainAccess: needsCursorKeychainAccess(
          summary,
          get(serverEnvironment.providersValueAtom(environmentId)),
        ),
      });
    }

    return {
      isCatalogReady: catalog.isReady,
      options,
      environments,
    };
  }).pipe(Atom.withLabel(`web-usage:${key}`)),
);

export interface UsageView {
  readonly merged: MergedUsage;
  /** All catalog entries, including entries outside the active filter. */
  readonly options: readonly EnvironmentUsageOption[];
  /** Coverage entries in the active filter. */
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  /** True until at least one selected environment has answered. */
  readonly isPending: boolean;
  /**
   * The usage to draw: this window's once a selected environment answers,
   * until then the last window answered for the same selection. Null while
   * nothing has answered and something still could.
   */
  readonly shown: { readonly window: UsageSummaryInput; readonly merged: MergedUsage } | null;
  /**
   * True while environments that have not failed are still answering. Failed
   * environments are reported through their own error rows: totals will not
   * improve by waiting on them, so they must not read as "still reporting".
   */
  readonly isPartial: boolean;
  readonly refresh: (input?: UsageSummaryInput) => Promise<void>;
}

/**
 * Merges every environment that has answered. `keepBucket` narrows the merge,
 * for example to one model; source ownership still applies, so the result
 * matches that slice of the full merge. Session counts are per directory and
 * are not narrowed.
 */
export function mergeAnsweredUsage(
  environments: readonly EnvironmentUsageStatus[],
  keepBucket?: (bucket: UsageBucket) => boolean,
): MergedUsage {
  const answered: EnvironmentUsage[] = environments.flatMap(({ environmentId, label, summary }) =>
    summary === null
      ? []
      : [
          {
            environmentId,
            label,
            summary:
              keepBucket === undefined
                ? summary
                : { ...summary, buckets: summary.buckets.filter(keepBucket) },
          },
        ],
  );
  return mergeUsage(answered, USAGE_CONTRACT_VERSION);
}

const NO_HIDDEN_PROVIDERS: ReadonlySet<UsageProviderKind> = new Set();

/**
 * Drops hidden providers' buckets and sources before merging, so totals,
 * shares, and session counts all describe only the visible providers.
 */
function withoutProviders(
  environments: readonly EnvironmentUsageStatus[],
  hiddenProviders: ReadonlySet<UsageProviderKind>,
): readonly EnvironmentUsageStatus[] {
  if (hiddenProviders.size === 0) return environments;
  return environments.map((environment) =>
    environment.summary === null
      ? environment
      : {
          ...environment,
          summary: {
            ...environment.summary,
            buckets: environment.summary.buckets.filter(
              (bucket) => !hiddenProviders.has(bucket.provider),
            ),
            sources: environment.summary.sources.filter(
              (source) => !hiddenProviders.has(source.fingerprint.provider),
            ),
          },
        },
  );
}

export function useUsage(
  input: UsageSummaryInput,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
  hiddenProviders: ReadonlySet<UsageProviderKind> = NO_HIDDEN_PROVIDERS,
): UsageView {
  const windowKey = useMemo(
    () =>
      JSON.stringify({
        input: {
          sinceDay: input.sinceDay,
          untilDay: input.untilDay,
          timeZone: input.timeZone,
          resolution: input.resolution,
          sinceTime: input.sinceTime,
          untilTime: input.untilTime,
          clientContractVersion: input.clientContractVersion,
        },
      }),
    [
      input.sinceDay,
      input.untilDay,
      input.timeZone,
      input.resolution,
      input.sinceTime,
      input.untilTime,
      input.clientContractVersion,
    ],
  );
  const atom = usageByWindowAtom(windowKey);
  const value = useAtomValue(atom);
  const environments = value.environments;
  const selectedEnvironments = useMemo(
    () =>
      selectedEnvironmentIds === null
        ? environments
        : environments.filter((environment) =>
            selectedEnvironmentIds.has(environment.environmentId),
          ),
    [environments, selectedEnvironmentIds],
  );

  const refresh = useCallback(
    (nextInput?: UsageSummaryInput) =>
      refreshUsage({
        registry: appAtomRegistry,
        server: serverEnvironment,
        presentations: environmentPresentations,
        // Only environments this connection may read; the others report a
        // permission error instead of a stale or failed rescan.
        environmentIds: selectedEnvironments
          .filter(
            (environment) =>
              environment.canReadDiagnostics &&
              readEnvironmentScope(environment.environmentId, AuthDiagnosticsReadScope),
          )
          .map(({ environmentId }) => environmentId),
        input: nextInput ?? (JSON.parse(windowKey) as UsageAtomKey).input,
      }),
    [selectedEnvironments, windowKey],
  );

  const merged = useMemo(
    () => mergeAnsweredUsage(withoutProviders(selectedEnvironments, hiddenProviders)),
    [selectedEnvironments, hiddenProviders],
  );

  const loadingState = getEnvironmentUsageLoadingState(selectedEnvironments);
  const isPending = !value.isCatalogReady || loadingState.isPending;
  // Retained summaries count: they are what `merged` draws while a refresh runs.
  const hasAnswered = selectedEnvironments.some((environment) => environment.summary !== null);

  // Stored during render, as React recommends for state that follows props, so
  // the kept usage is on screen in the same frame the new window starts pending.
  const [lastAnswered, setLastAnswered] = useState<
    | (NonNullable<UsageView["shown"]> & {
        readonly selection: typeof selectedEnvironmentIds;
        readonly hidden: typeof hiddenProviders;
      })
    | null
  >(null);
  if (
    hasAnswered &&
    (lastAnswered?.merged !== merged ||
      lastAnswered.window !== input ||
      lastAnswered.selection !== selectedEnvironmentIds ||
      lastAnswered.hidden !== hiddenProviders)
  ) {
    setLastAnswered({
      window: input,
      merged,
      selection: selectedEnvironmentIds,
      hidden: hiddenProviders,
    });
  }
  // Kept usage only stands in for the same environments and provider filter.
  const kept =
    lastAnswered?.selection === selectedEnvironmentIds && lastAnswered.hidden === hiddenProviders
      ? lastAnswered
      : null;
  // With no answers, even failed ones keep the last answered usage on screen.
  const shown =
    hasAnswered
      ? { window: input, merged }
      : (kept ?? (isPending ? null : { window: input, merged }));

  return {
    merged,
    options: value.options,
    environments,
    selectedEnvironments,
    isPending,
    shown,
    isPartial: loadingState.isPartial,
    refresh,
  };
}
