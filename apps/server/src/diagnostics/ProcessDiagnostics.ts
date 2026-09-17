import type {
  ResourceTelemetryProcessCategory,
  ServerProcessDiagnosticsEntry,
  ServerProcessDiagnosticsResult,
  ServerProcessSignal,
  ServerSignalProcessResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as PortScanner from "../preview/PortScanner.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import {
  LISTENER_START_TOLERANCE_MS,
  readListenerProcesses,
  type ListenerProcess,
} from "./ListenerProcesses.ts";
import { resolveProcessOrigins } from "./ProcessOrigins.ts";

export class ProcessSignalFailed extends Schema.TaggedError<ProcessSignalFailed>()(
  "ProcessSignalFailed",
  {
    pid: Schema.Number,
    signal: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to signal process ${this.pid} with ${this.signal}.`;
  }
}

export class ProcessDiagnostics extends Context.Service<
  ProcessDiagnostics,
  {
    readonly read: Effect.Effect<ServerProcessDiagnosticsResult>;
    readonly signal: (input: {
      readonly pid: number;
      readonly startTimeMs: number;
      readonly signal: ServerProcessSignal;
    }) => Effect.Effect<ServerSignalProcessResult>;
  }
>()("t3/diagnostics/ProcessDiagnostics") {}

function formatElapsed(runTimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(runTimeMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function canSignalCategory(category: ResourceTelemetryProcessCategory): boolean {
  return (
    category === "server-child" || category === "provider-root" || category === "terminal-root"
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("makeProcessDiagnostics")(function* () {
  const telemetry = yield* ResourceTelemetry.ResourceTelemetry;
  const portDiscovery = yield* PortScanner.PortDiscovery;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const refreshedTelemetry = telemetry.refresh.pipe(Effect.catch(() => telemetry.latest));

  // Dev servers outside the tree, found by their ports (see ListenerProcesses).
  const readListeners = (knownPids: ReadonlySet<number>) =>
    Effect.gen(function* () {
      const servers = yield* portDiscovery.scan();
      const nowMs = yield* Clock.currentTimeMillis;
      return yield* readListenerProcesses(processRunner, servers, knownPids, nowMs);
    });
  const listenerEntry = (listener: ListenerProcess): ServerProcessDiagnosticsEntry => ({
    pid: listener.pid,
    startTimeMs: listener.startTimeMs,
    ppid: listener.ppid,
    pgid: Option.none(),
    status: listener.status || "Unknown",
    cpuPercent: listener.cpuPercent,
    rssBytes: listener.rssBytes,
    elapsed: formatElapsed(listener.runTimeMs),
    command: listener.command || "unknown",
    depth: 0,
    childPids: [],
    origin: { kind: "listener" },
    ...(listener.ports[0] !== undefined ? { port: listener.ports[0] } : {}),
    ...(listener.cwd ? { cwd: listener.cwd } : {}),
  });

  const read: ProcessDiagnostics["Service"]["read"] = Effect.gen(function* () {
    const snapshot = yield* refreshedTelemetry;
    const listeners = yield* readListeners(
      new Set(snapshot.processes.map((entry) => entry.identity.pid)),
    );
    return { snapshot, listeners };
  }).pipe(
    Effect.map(({ snapshot, listeners }) => {
      // Origins resolve over the whole tree, so a tool spawned three levels
      // under a provider still lands on that provider's thread.
      const origins = resolveProcessOrigins(
        snapshot.processes.map((entry) => ({
          pid: entry.identity.pid,
          ppid: entry.ppid,
          command: entry.command,
        })),
      );
      const treeProcesses = snapshot.processes
        .filter((entry) => canSignalCategory(entry.category))
        .map((entry): ServerProcessDiagnosticsEntry => ({
          pid: entry.identity.pid,
          startTimeMs: entry.identity.startTimeMs,
          ppid: entry.ppid,
          pgid: Option.none(),
          status: entry.status || "Unknown",
          cpuPercent: entry.cpuPercent,
          rssBytes: entry.residentBytes,
          elapsed: formatElapsed(entry.runTimeMs),
          command: entry.command || entry.name || "unknown",
          depth: Math.max(0, entry.depth - 1),
          childPids: entry.childPids,
          ...(origins.has(entry.identity.pid) ? { origin: origins.get(entry.identity.pid) } : {}),
        }));
      const processes = [...treeProcesses, ...listeners.map(listenerEntry)];
      return {
        serverPid: process.pid,
        readAt: snapshot.readAt,
        processCount: processes.length,
        totalRssBytes: processes.reduce((total, entry) => total + entry.rssBytes, 0),
        totalCpuPercent: processes.reduce((total, entry) => total + entry.cpuPercent, 0),
        processes,
        error: Option.map(snapshot.health.native.lastError, (message) => ({ message })),
      };
    }),
  );

  const signal: ProcessDiagnostics["Service"]["signal"] = Effect.fn("ProcessDiagnostics.signal")(
    function* (input) {
      if (input.pid === process.pid) {
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some("Refusing to signal the T3 server process."),
        };
      }
      // Not in the tree: a listener the port scan still sees is fair game,
      // matched on pid and a start stamp within the rounding tolerance. The
      // tree's pids are excluded exactly as in read, so a tree process the
      // category check refused cannot come back in through its port.
      const matchesListener = (treePids: Iterable<number>) =>
        Effect.map(readListeners(new Set([process.pid, ...treePids])), (listeners) =>
          listeners.some(
            (entry) =>
              entry.pid === input.pid &&
              Math.abs(entry.startTimeMs - input.startTimeMs) <= LISTENER_START_TOLERANCE_MS,
          ),
        );
      const current = yield* telemetry.refresh.pipe(Effect.option);
      if (Option.isNone(current)) {
        // Without the sidecar the tree cannot be re-checked, but a listener's
        // identity comes from the fresh port scan, so those still work (as in
        // a plain web checkout). The last known tree keeps its pids excluded.
        const stale = yield* telemetry.latest.pipe(Effect.option);
        const treePids = Option.isSome(stale)
          ? stale.value.processes.map((entry) => entry.identity.pid)
          : [];
        if (yield* matchesListener(treePids)) return yield* kill(input);
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(
            `Could not refresh process ${input.pid}; refusing to signal a stale identity.`,
          ),
        };
      }
      const selected = current.value.processes.find(
        (entry) =>
          entry.identity.pid === input.pid && entry.identity.startTimeMs === input.startTimeMs,
      );
      if (!selected) {
        if (yield* matchesListener(current.value.processes.map((entry) => entry.identity.pid))) {
          return yield* kill(input);
        }
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(
            `Process ${input.pid} no longer matches the selected process identity.`,
          ),
        };
      }
      if (!canSignalCategory(selected.category)) {
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(`Process ${input.pid} is not a signalable T3 backend descendant.`),
        };
      }
      return yield* kill(input);
    },
  );

  function kill(input: {
    readonly pid: number;
    readonly signal: ServerProcessSignal;
  }): Effect.Effect<ServerSignalProcessResult> {
    return Effect.try({
      try: () => {
        process.kill(input.pid, input.signal);
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: true,
          message: Option.none(),
        };
      },
      catch: (cause) =>
        new ProcessSignalFailed({
          pid: input.pid,
          signal: input.signal,
          cause,
        }),
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(
            error instanceof Error ? error.message : "Failed to signal process.",
          ),
        }),
      ),
    );
  }

  return ProcessDiagnostics.of({ read, signal });
});

export const layer = Layer.effect(ProcessDiagnostics, make());
