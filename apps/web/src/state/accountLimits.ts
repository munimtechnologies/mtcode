/**
 * Multi-environment account-limits state.
 *
 * Every connected environment reports one snapshot per provider instance.
 * Within an environment, unkeyed (pre-attribution) snapshots fold onto the
 * driver's default instance, freshest wins.
 *
 * Across environments, two kinds of duplicate collapse:
 *  - Byte-identical rows (same instance, stamp, windows) — worktree servers
 *    sharing a home, or two machines seeded from the same transcripts.
 *  - The same subscription reading (same plan and window usage) reported
 *    from several computers. Cursor's monthly pools are one account, not
 *    one-per-machine; showing them three times is noise. Differing windows
 *    stay separate so two Codex machines with different remaining quota
 *    cannot overwrite each other, and empty snapshots never collapse
 *    across clocks.
 *
 * @module state/accountLimits
 */
import { useAtomValue } from "@effect/atom-react";
import {
  ACCOUNT_LIMITS_ACCEPTED_VERSIONS,
  ProviderInstanceId,
  type AccountLimitsSnapshot,
  type EnvironmentId,
  type ServerProvider,
  type UsageProviderKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { getProviderInstanceEntry } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentLimitsStatus {
  readonly environmentId: EnvironmentId;
  /** The environment's display label, for when several report. */
  readonly environmentLabel: string | null;
  /** Whether this is the primary (local) environment - captions resolve
   * environment names through the shared option-label contract, which
   * needs it. */
  readonly environmentIsPrimary: boolean;
  readonly isPending: boolean;
  readonly snapshots: readonly AccountLimitsSnapshot[] | null;
  /** Streamed provider config; the source of instance display names. */
  readonly providers: readonly ServerProvider[] | null;
}

const accountLimitsAtom = Atom.make((get): readonly EnvironmentLimitsStatus[] => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const statuses: EnvironmentLimitsStatus[] = [];
  for (const [environmentId, presentation] of presentations) {
    const result = get(serverEnvironment.accountLimits({ environmentId, input: {} }));
    const summary = Option.getOrNull(AsyncResult.value(result));
    statuses.push({
      environmentId,
      environmentLabel: presentation.entry.target.label ?? null,
      environmentIsPrimary: presentation.entry.target._tag === "PrimaryConnectionTarget",
      providers: presentation.serverConfig?.providers ?? null,
      isPending: result.waiting,
      snapshots:
        summary === null || !ACCOUNT_LIMITS_ACCEPTED_VERSIONS.includes(summary.contractVersion)
          ? null
          : summary.snapshots,
    });
  }
  return statuses;
}).pipe(Atom.withLabel("web-account-limits"));

/**
 * Usage/limits pages speak the usage contract's provider kinds; the provider
 * config speaks driver kinds. Claude is the one that differs.
 */
function usageProviderKindForDriver(driver: string): UsageProviderKind | null {
  const kind = driver === "claudeAgent" ? "claude" : driver;
  return (
    ((["claude", "codex", "cursor", "grok", "opencode"] as const).find(
      (candidate) => candidate === kind,
    ) as UsageProviderKind | undefined) ?? null
  );
}

/**
 * Provider kinds enabled on at least one connected computer. `null` while no
 * environment has streamed its provider config yet - callers show everything
 * rather than blink rows out during connect.
 *
 * A provider the user switched off in Settings has no place on a usage or
 * limits page: there is nothing to spend and nothing to run.
 */
export function useEnabledUsageProviders(): ReadonlySet<UsageProviderKind> | null {
  const environments = useAtomValue(accountLimitsAtom);
  return useMemo(() => {
    const known = environments.filter((environment) => environment.providers !== null);
    if (known.length === 0) return null;
    const enabled = new Set<UsageProviderKind>();
    for (const environment of known) {
      for (const provider of environment.providers ?? []) {
        if (!provider.enabled || provider.status === "disabled") continue;
        const kind = usageProviderKindForDriver(String(provider.driver));
        if (kind !== null) enabled.add(kind);
      }
    }
    return enabled;
  }, [environments]);
}

/** One rendered limits row: a provider instance seen from one environment. */
export interface AccountLimitsRow {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string | null;
  readonly environmentIsPrimary: boolean;
  /**
   * Instance display name off the provider config already streaming to the
   * client, else the raw instance id. Never the account email: the provider
   * UI deliberately blurs emails until clicked, and a caption must not leak
   * what that redaction protects. Rendering decides when a caption is worth
   * showing.
   */
  readonly instanceLabel: string;
  readonly snapshot: AccountLimitsSnapshot;
}

/** What an unkeyed (pre-instance-attribution) snapshot always meant. */
export const legacyInstanceIdFor = (provider: UsageProviderKind): string =>
  provider === "claude" ? "claudeAgent" : provider;

function roundResetToMinute(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const ms = Date.parse(resetsAt);
  if (!Number.isFinite(ms)) return resetsAt;
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

/**
 * Identity of the subscription those windows describe, ignoring which
 * computer reported them and when. Empty window lists are not a reading —
 * they must not collapse two environments' "no data yet" clocks.
 */
export function subscriptionFingerprint(snapshot: AccountLimitsSnapshot): string | null {
  if (snapshot.windows.length === 0) return null;
  return JSON.stringify([
    snapshot.provider,
    snapshot.plan,
    snapshot.windows.map((window) => ({
      id: window.id,
      usedPercent: Math.round(window.usedPercent),
      resetsAt: roundResetToMinute(window.resetsAt),
      windowMinutes: window.windowMinutes,
    })),
  ]);
}

function preferLimitsRow(current: AccountLimitsRow, candidate: AccountLimitsRow): AccountLimitsRow {
  if (candidate.environmentIsPrimary !== current.environmentIsPrimary) {
    return candidate.environmentIsPrimary ? candidate : current;
  }
  return candidate.snapshot.asOf > current.snapshot.asOf ? candidate : current;
}

/**
 * Pure merge, exported for tests: dedupe freshest-wins per instance WITHIN
 * an environment, then collapse the same subscription reading across
 * computers (see module doc).
 */
export function mergeEnvironmentLimits(
  statuses: readonly EnvironmentLimitsStatus[],
): ReadonlyMap<UsageProviderKind, readonly AccountLimitsRow[]> {
  const byProvider = new Map<UsageProviderKind, AccountLimitsRow[]>();
  // Two environments on one machine (worktree servers) can hold identical
  // snapshots. Byte-identical rows carry no extra information, so exact
  // duplicates collapse; rows that differ at all - clocks included - stay,
  // unless they are the same subscription windows reported from several
  // computers (handled below).
  const seenExact = new Set<string>();
  const seenSubscription = new Map<string, { provider: UsageProviderKind; index: number }>();
  for (const status of statuses) {
    const byInstance = new Map<string, AccountLimitsSnapshot>();
    for (const snapshot of status.snapshots ?? []) {
      const key = JSON.stringify([
        snapshot.provider,
        snapshot.instanceId ?? legacyInstanceIdFor(snapshot.provider),
      ]);
      const current = byInstance.get(key);
      // ISO-8601 strings order lexicographically.
      if (current === undefined || snapshot.asOf > current.asOf) {
        byInstance.set(key, snapshot);
      }
    }
    for (const snapshot of byInstance.values()) {
      const instanceId = snapshot.instanceId ?? legacyInstanceIdFor(snapshot.provider);
      // "Byte-identical" must mean the whole row: keying on the stamp alone
      // would let two environments' same-instant-but-different readings
      // collapse into one, silently deleting a real account's numbers.
      const duplicateKey = JSON.stringify([
        snapshot.provider,
        instanceId,
        snapshot.asOf,
        snapshot.source,
        snapshot.plan,
        snapshot.windows,
      ]);
      if (seenExact.has(duplicateKey)) continue;
      seenExact.add(duplicateKey);
      // Resolve the caption through the app-wide instance display-name
      // contract (explicit name wins, non-default ids humanize, defaults
      // keep the brand label), so Limits names accounts the same way the
      // picker and provider settings do.
      const entry = getProviderInstanceEntry(
        status.providers ?? [],
        ProviderInstanceId.make(instanceId),
      );
      const row: AccountLimitsRow = {
        environmentId: status.environmentId,
        environmentLabel: status.environmentLabel,
        environmentIsPrimary: status.environmentIsPrimary,
        instanceLabel: entry?.displayName ?? instanceId,
        snapshot,
      };
      const fingerprint = subscriptionFingerprint(snapshot);
      if (fingerprint !== null) {
        const existing = seenSubscription.get(fingerprint);
        if (existing !== undefined) {
          const rows = byProvider.get(existing.provider);
          const current = rows?.[existing.index];
          if (rows !== undefined && current !== undefined) {
            rows[existing.index] = preferLimitsRow(current, row);
          }
          continue;
        }
      }
      const rows = byProvider.get(snapshot.provider) ?? [];
      if (fingerprint !== null) {
        seenSubscription.set(fingerprint, { provider: snapshot.provider, index: rows.length });
      }
      rows.push(row);
      byProvider.set(snapshot.provider, rows);
    }
  }
  for (const rows of byProvider.values()) {
    // A display name shared by two DIFFERENT instances identifies nothing -
    // two unnamed Codex accounts must not both caption as "Codex". Those
    // rows fall back to their raw instance id, which is unique per
    // environment. Rows sharing one instance across environments keep the
    // shared name; the environment label disambiguates them in rendering.
    const instancesPerLabel = new Map<string, Set<string>>();
    for (const row of rows) {
      const instanceId = row.snapshot.instanceId ?? legacyInstanceIdFor(row.snapshot.provider);
      const ids = instancesPerLabel.get(row.instanceLabel) ?? new Set<string>();
      ids.add(instanceId);
      instancesPerLabel.set(row.instanceLabel, ids);
    }
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row === undefined) continue;
      if ((instancesPerLabel.get(row.instanceLabel)?.size ?? 0) > 1) {
        rows[index] = {
          ...row,
          instanceLabel: row.snapshot.instanceId ?? legacyInstanceIdFor(row.snapshot.provider),
        };
      }
    }
    rows.sort(
      (a, b) =>
        a.instanceLabel.localeCompare(b.instanceLabel) ||
        a.environmentId.localeCompare(b.environmentId),
    );
  }
  return byProvider;
}

export interface AccountLimitsView {
  /**
   * Rows grouped per provider. Several rows under one provider mean several
   * instances (or several environments), each labeled; most setups have
   * exactly one.
   */
  readonly byProvider: ReadonlyMap<UsageProviderKind, readonly AccountLimitsRow[]>;
  /** Environments that have answered - >1 means rows need their environment named. */
  readonly reportingEnvironments: number;
  /** True until at least one environment has answered. */
  readonly isPending: boolean;
  /**
   * True while any environment is still answering. A provider with no
   * snapshot is "loading" while this holds and "no data" once it clears -
   * the first environment to answer must not decide that for the rest.
   */
  readonly isSettling: boolean;
  readonly refresh: () => void;
}

export function useAccountLimits(): AccountLimitsView {
  const environments = useAtomValue(accountLimitsAtom);

  const byProvider = useMemo(() => mergeEnvironmentLimits(environments), [environments]);

  const refresh = useCallback(() => {
    for (const environment of environments) {
      appAtomRegistry.refresh(
        serverEnvironment.accountLimits({ environmentId: environment.environmentId, input: {} }),
      );
    }
  }, [environments]);

  const answered = environments.filter((environment) => environment.snapshots !== null).length;
  const stillReporting = environments.filter(
    (environment) => environment.snapshots === null && environment.isPending,
  ).length;

  return {
    byProvider,
    reportingEnvironments: answered,
    isPending: answered === 0 && stillReporting > 0,
    isSettling: stillReporting > 0,
    refresh,
  };
}
