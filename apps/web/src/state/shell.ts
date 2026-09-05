import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
  type ConnectionProjectionPhase,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
  type EnvironmentShellStatus,
  type EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { isHostedStaticApp } from "../hostedPairing";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

const EMPTY_SHELL_ENVIRONMENT_IDS: ReadonlySet<EnvironmentId> = new Set();

function environmentIdSetsEqual(
  current: ReadonlySet<EnvironmentId>,
  next: ReadonlySet<EnvironmentId>,
): boolean {
  if (current.size !== next.size) {
    return false;
  }
  for (const environmentId of current) {
    if (!next.has(environmentId)) {
      return false;
    }
  }
  return true;
}

let authoritativeConnectionGenerations = new Map<EnvironmentId, number>();

function shellEnvironmentRetainsAuthority(input: {
  readonly shellStatus: EnvironmentShellStatus;
  readonly connectionPhase: ConnectionProjectionPhase;
  readonly connectionGeneration: number;
  readonly authoritativeGeneration: number | null;
}): boolean {
  return (
    input.connectionPhase !== "disconnected" &&
    (input.shellStatus === "live" || input.authoritativeGeneration === input.connectionGeneration)
  );
}

export const authoritativeShellEnvironmentIdsAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    authoritativeConnectionGenerations = new Map();
    return EMPTY_SHELL_ENVIRONMENT_IDS;
  }
  const environmentIds = new Set<EnvironmentId>();
  const nextAuthoritativeConnectionGenerations = new Map<EnvironmentId, number>();
  for (const environmentId of catalog.value.entries.keys()) {
    const shell = get(environmentShell.stateValueAtom(environmentId));
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    // A same-generation foreground resubscription is still authoritative while its shell catches
    // up. A real reconnect has a new generation and must reach live before offline work is trusted.
    if (
      shellEnvironmentRetainsAuthority({
        shellStatus: shell.status,
        connectionPhase: connectionProjectionPhase(connection),
        connectionGeneration: connection.generation,
        authoritativeGeneration: authoritativeConnectionGenerations.get(environmentId) ?? null,
      })
    ) {
      environmentIds.add(environmentId);
      nextAuthoritativeConnectionGenerations.set(environmentId, connection.generation);
    }
  }
  authoritativeConnectionGenerations = nextAuthoritativeConnectionGenerations;
  return environmentIds;
}).pipe(
  Atom.withEquality(environmentIdSetsEqual),
  Atom.withLabel("web-authoritative-shell-environment-ids"),
);

export const connectedShellEnvironmentIdsAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    return EMPTY_SHELL_ENVIRONMENT_IDS;
  }
  const environmentIds = new Set<EnvironmentId>();
  for (const environmentId of catalog.value.entries.keys()) {
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    // Keep connection-scoped observers mounted while the shell catches up after reconnect or wake.
    if (connectionProjectionPhase(connection) !== "disconnected") {
      environmentIds.add(environmentId);
    }
  }
  return environmentIds;
}).pipe(
  Atom.withEquality(environmentIdSetsEqual),
  Atom.withLabel("web-connected-shell-environment-ids"),
);

export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    return false;
  }
  for (const environmentId of catalog.value.entries.keys()) {
    if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) {
      continue;
    }
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (connectionProjectionPhase(connection) !== "disconnected") {
      return false;
    }
    // A retrying environment is only transiently disconnected; give it its
    // first retries before letting the landing settle without its snapshot.
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
      return false;
    }
  }
  return true;
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));

/** Cached or missing snapshots cannot establish that a saved project no longer exists. */
export function createAllEnvironmentProjectSnapshotsReadyAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly requiresPrimaryEnvironment: boolean;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    // The persisted catalog can emit before platform discovery registers the
    // primary environment. Neither that gap nor an empty catalog proves absence.
    if (!catalog.isReady || catalog.entries.size === 0) return false;
    if (
      input.requiresPrimaryEnvironment &&
      !Array.from(catalog.entries.values()).some(
        (entry) => entry.target._tag === "PrimaryConnectionTarget",
      )
    ) {
      return false;
    }
    for (const environmentId of catalog.entries.keys()) {
      const shell = get(input.shellStateValueAtom(environmentId));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) return false;
    }
    return true;
  }).pipe(Atom.withLabel("web-all-environment-project-snapshots-ready"));
}

export const allEnvironmentProjectSnapshotsReadyAtom =
  createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    shellStateValueAtom: environmentShell.stateValueAtom,
    requiresPrimaryEnvironment: !isHostedStaticApp(),
  });
