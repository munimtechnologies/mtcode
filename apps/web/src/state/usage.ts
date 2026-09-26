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
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { needsCursorKeychainAccess, refreshUsage } from "@t3tools/client-runtime/state/usage";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import {
  getEnvironmentUsageLoadingState,
  type EnvironmentUsageOption,
} from "./usageEnvironmentScope";

export type { EnvironmentUsageOption } from "./usageEnvironmentScope";

export interface EnvironmentUsageStatus extends EnvironmentUsageOption {
  readonly isPending: boolean;
  /** A connected usage query failed. Connection coverage uses `phase`. */
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
      const connectionResult = get(environmentCatalog.stateAtom(environmentId));
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
  readonly isPartial: boolean;
  readonly refresh: (input?: UsageSummaryInput) => Promise<void>;
}

export function useUsage(
  input: UsageSummaryInput,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
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
        environmentIds: selectedEnvironments.map(({ environmentId }) => environmentId),
        input: nextInput ?? (JSON.parse(windowKey) as UsageAtomKey).input,
      }),
    [selectedEnvironments, windowKey],
  );

  const merged = useMemo(() => {
    const answered: EnvironmentUsage[] = selectedEnvironments.flatMap((environment) =>
      environment.summary === null
        ? []
        : [
            {
              environmentId: environment.environmentId,
              label: environment.label,
              summary: environment.summary,
            },
          ],
    );
    return mergeUsage(answered, USAGE_CONTRACT_VERSION);
  }, [selectedEnvironments]);

  const loadingState = getEnvironmentUsageLoadingState(selectedEnvironments);

  return {
    merged,
    options: value.options,
    environments,
    selectedEnvironments,
    isPending: !value.isCatalogReady || loadingState.isPending,
    isPartial: loadingState.isPartial,
    refresh,
  };
}
