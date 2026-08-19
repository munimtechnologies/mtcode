import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

export interface EnvironmentUsageOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly phase: EnvironmentConnectionPhase;
}

export function resolveEnvironmentUsageScope(
  options: readonly EnvironmentUsageOption[],
  selectedEnvironmentId: EnvironmentId | null,
): {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly environments: readonly EnvironmentUsageOption[];
} {
  const effectiveSelection =
    selectedEnvironmentId !== null &&
    options.some((environment) => environment.environmentId === selectedEnvironmentId)
      ? selectedEnvironmentId
      : null;
  return {
    selectedEnvironmentId: effectiveSelection,
    environments:
      effectiveSelection === null
        ? options
        : options.filter((environment) => environment.environmentId === effectiveSelection),
  };
}

interface EnvironmentUsageLoadingEntry {
  readonly phase: EnvironmentConnectionPhase;
  readonly isPending: boolean;
  readonly summary: unknown | null;
  readonly error: string | null;
}

export function isEnvironmentUsageStillReporting(
  environment: EnvironmentUsageLoadingEntry,
): boolean {
  // A retained summary does not mean this environment has reported: it is the
  // previous request's answer, still on screen while the refresh runs.
  return environment.isPending && environment.error === null;
}

export function getEnvironmentUsageLoadingState(
  environments: readonly EnvironmentUsageLoadingEntry[],
): { readonly isPending: boolean; readonly isPartial: boolean } {
  // SWR keeps the previous summary on screen while a refresh is in flight, so
  // a retained value belongs to the *previous* request. Counting it as an
  // answer settled a refresh before any environment had reported new numbers.
  const answeredCount = environments.filter(
    (environment) => environment.summary !== null && !environment.isPending,
  ).length;
  const stillReporting = environments.filter(isEnvironmentUsageStillReporting).length;

  return {
    isPending: answeredCount === 0 && stillReporting > 0,
    isPartial: answeredCount > 0 && stillReporting > 0,
  };
}
