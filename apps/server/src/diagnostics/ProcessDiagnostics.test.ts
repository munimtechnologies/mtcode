import { describe, expect, it } from "@effect/vitest";
import type {
  DesktopHostTelemetrySnapshot,
  ResourceMonitorSnapshotEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { DiscoveredLocalServer } from "@t3tools/contracts";

import * as PortScanner from "../preview/PortScanner.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as NativeTelemetryClient from "../resourceTelemetry/NativeTelemetryClient.ts";
import * as ResourceAttribution from "../resourceTelemetry/ResourceAttribution.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import * as ProcessDiagnostics from "./ProcessDiagnostics.ts";
import { registerProcessOrigin, resetProcessOriginsForTest } from "./ProcessOrigins.ts";

function makeNativeSnapshot(
  processes: ResourceMonitorSnapshotEvent["processes"],
): ResourceMonitorSnapshotEvent {
  return {
    version: 3,
    type: "snapshot",
    sequence: 1,
    sampledAtUnixMs: DateTime.toEpochMillis(DateTime.makeUnsafe("2026-05-05T10:00:00.000Z")),
    collectionDurationMicros: 250,
    scannedProcessCount: processes.length,
    retainedProcessCount: processes.length,
    inaccessibleProcessCount: 0,
    processes,
  };
}

function makeTelemetryLayer(
  snapshot: ResourceMonitorSnapshotEvent,
  desktopSnapshot?: DesktopHostTelemetrySnapshot,
) {
  const nativeLayer = NativeTelemetryClient.layerTest({
    sampleNow: Effect.succeed({ generation: 0, snapshot }),
    health: Effect.succeed({
      status: "healthy",
      hello: Option.none(),
      lastSampleAt: Option.some(DateTime.makeUnsafe(snapshot.sampledAtUnixMs)),
      lastError: Option.none(),
      restartCount: 0,
      sampleIntervalMs: 1_000,
    }),
  });
  const desktopLayer = desktopSnapshot
    ? DesktopTelemetryReceiver.layerTest({
        latest: Effect.succeedSome(desktopSnapshot),
        health: Effect.succeed({
          status: "healthy",
          lastSampleAt: Option.some(DateTime.makeUnsafe(desktopSnapshot.sampledAtUnixMs)),
          lastError: Option.none(),
        }),
      })
    : DesktopTelemetryReceiver.layerTest();
  return ResourceTelemetry.layer.pipe(
    Layer.provide(Layer.mergeAll(nativeLayer, desktopLayer, ResourceAttribution.layer)),
  );
}

/** The port scanner and process runner the diagnostics consult for off-tree listeners. */
function makeSupportLayers(input?: {
  readonly servers?: ReadonlyArray<DiscoveredLocalServer>;
  readonly outputs?: Readonly<Record<string, string>>;
}) {
  const portDiscovery = Layer.succeed(PortScanner.PortDiscovery, {
    scan: () => Effect.succeed(input?.servers ?? []),
  } as unknown as PortScanner.PortDiscovery["Service"]);
  const processRunner = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (request: ProcessRunner.ProcessRunInput) =>
      Effect.succeed({
        stdout: input?.outputs?.[request.command] ?? "",
        stderr: "",
        code: 0,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
  } as unknown as ProcessRunner.ProcessRunner["Service"]);
  return Layer.mergeAll(portDiscovery, processRunner);
}

describe("ProcessDiagnostics", () => {
  it.effect("projects live process data from resource telemetry", () =>
    Effect.gen(function* () {
      const snapshot = makeNativeSnapshot([
        {
          pid: process.pid,
          ppid: 1,
          startTimeMs: 1_000,
          runTimeMs: 60_000,
          name: "node",
          command: "t3 server",
          status: "Running",
          cpuPercent: 0,
          cpuTimeMs: 100,
          residentBytes: 1_024,
          virtualBytes: 2_048,
          ioReadBytes: 100,
          ioWriteBytes: 200,
          ioSemantics: "storage",
        },
        {
          pid: 4_242,
          ppid: process.pid,
          startTimeMs: 2_000,
          runTimeMs: 4_000,
          name: "agent",
          command: "codex app-server",
          status: "Running",
          cpuPercent: 1.5,
          cpuTimeMs: 60,
          residentBytes: 2_048,
          virtualBytes: 4_096,
          ioReadBytes: 300,
          ioWriteBytes: 400,
          ioSemantics: "storage",
        },
      ]);
      const telemetryLayer = makeTelemetryLayer(snapshot);
      const layer = ProcessDiagnostics.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(telemetryLayer, makeSupportLayers())),
      );

      const diagnostics = yield* Effect.gen(function* () {
        const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
        return yield* processDiagnostics.read;
      }).pipe(Effect.provide(layer));

      expect(diagnostics.processes.map((process) => process.pid)).toEqual([4242]);
      expect(diagnostics.processes[0]?.startTimeMs).toBe(2_000);
      expect(diagnostics.processes[0]?.cpuPercent).toBe(1.5);
      expect(diagnostics.processes[0]?.rssBytes).toBe(2_048);
      expect(diagnostics.processes[0]?.origin).toBeUndefined();
    }),
  );

  it.effect("lists a dev server that left the tree by its listening port", () =>
    Effect.gen(function* () {
      resetProcessOriginsForTest();
      const snapshot = makeNativeSnapshot([
        {
          pid: process.pid,
          ppid: 1,
          startTimeMs: 1_000,
          runTimeMs: 60_000,
          name: "node",
          command: "t3 server",
          status: "Running",
          cpuPercent: 0,
          cpuTimeMs: 100,
          residentBytes: 1_024,
          virtualBytes: 2_048,
          ioReadBytes: 100,
          ioWriteBytes: 200,
          ioSemantics: "storage",
        },
      ]);
      const support = makeSupportLayers({
        servers: [
          {
            host: "localhost",
            port: 3000,
            url: "http://localhost:3000",
            processName: "deno",
            pid: 61013,
            terminal: null,
          } as DiscoveredLocalServer,
        ],
        outputs: {
          ps: "61013 61008 15:07 51200 0.5 S+ deno run --ext=js -A dev.ts\n",
          lsof: "p61013\nfcwd\nn/Users/maxi/GitHub/finance\n",
        },
      });
      const layer = ProcessDiagnostics.layer.pipe(
        Layer.provide(Layer.mergeAll(makeTelemetryLayer(snapshot), support)),
      );

      const diagnostics = yield* Effect.gen(function* () {
        const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
        return yield* processDiagnostics.read;
      }).pipe(Effect.provide(layer));

      const listener = diagnostics.processes.find((entry) => entry.pid === 61013);
      expect(listener).toMatchObject({
        origin: { kind: "listener" },
        port: 3000,
        cwd: "/Users/maxi/GitHub/finance",
        command: "deno run --ext=js -A dev.ts",
        rssBytes: 51200 * 1024,
        elapsed: "15:07",
      });
      expect(diagnostics.processCount).toBe(1);
    }),
  );

  it.effect("labels processes with the thread whose provider spawned their ancestor", () =>
    Effect.gen(function* () {
      resetProcessOriginsForTest();
      registerProcessOrigin(4_242, { kind: "provider", provider: "codex", threadId: "thread-1" });
      const base = {
        status: "Running",
        cpuTimeMs: 20,
        virtualBytes: 1_024,
        ioReadBytes: 0,
        ioWriteBytes: 0,
        ioSemantics: "storage" as const,
      };
      const snapshot = makeNativeSnapshot([
        {
          ...base,
          pid: process.pid,
          ppid: 1,
          startTimeMs: 1_000,
          runTimeMs: 60_000,
          name: "node",
          command: "t3 server",
          cpuPercent: 0,
          residentBytes: 1_024,
        },
        {
          ...base,
          pid: 4_242,
          ppid: process.pid,
          startTimeMs: 2_000,
          runTimeMs: 4_000,
          name: "codex",
          command: "codex app-server",
          cpuPercent: 1,
          residentBytes: 2_048,
        },
        {
          ...base,
          pid: 4_343,
          ppid: 4_242,
          startTimeMs: 3_000,
          runTimeMs: 1_000,
          name: "zsh",
          command: "/bin/zsh -lc 'pnpm test'",
          cpuPercent: 3,
          residentBytes: 512,
        },
      ]);
      const layer = ProcessDiagnostics.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(makeTelemetryLayer(snapshot), makeSupportLayers())),
      );
      const diagnostics = yield* Effect.gen(function* () {
        const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
        return yield* processDiagnostics.read;
      }).pipe(Effect.provide(layer));
      const byPid = new Map(diagnostics.processes.map((entry) => [entry.pid, entry]));
      expect(byPid.get(4_242)?.origin).toEqual({
        kind: "provider",
        provider: "codex",
        threadId: "thread-1",
      });
      expect(byPid.get(4_343)?.origin?.threadId).toBe("thread-1");
      resetProcessOriginsForTest();
    }),
  );

  it.effect("rejects stale process identities before signaling", () =>
    Effect.gen(function* () {
      const snapshot = makeNativeSnapshot([]);
      const telemetryLayer = makeTelemetryLayer(snapshot);
      const layer = ProcessDiagnostics.layer.pipe(
        Layer.provide(Layer.mergeAll(telemetryLayer, makeSupportLayers())),
      );

      const result = yield* Effect.service(ProcessDiagnostics.ProcessDiagnostics).pipe(
        Effect.flatMap((processDiagnostics) =>
          processDiagnostics.signal({
            pid: 4_242,
            startTimeMs: 2_000,
            signal: "SIGINT",
          }),
        ),
        Effect.provide(layer),
      );

      expect(result).toEqual({
        pid: 4242,
        signal: "SIGINT",
        signaled: false,
        message: Option.some("Process 4242 no longer matches the selected process identity."),
      });
    }),
  );

  it.effect("refuses to signal when a fresh identity check cannot be collected", () =>
    Effect.gen(function* () {
      const snapshot = makeNativeSnapshot([
        {
          pid: 4_242,
          ppid: process.pid,
          startTimeMs: 2_000,
          runTimeMs: 4_000,
          name: "agent",
          command: "codex app-server",
          status: "Running",
          cpuPercent: 1.5,
          cpuTimeMs: 60,
          residentBytes: 2_048,
          virtualBytes: 4_096,
          ioReadBytes: 300,
          ioWriteBytes: 400,
          ioSemantics: "storage",
        },
      ]);
      const staleTelemetry = yield* Effect.service(ResourceTelemetry.ResourceTelemetry).pipe(
        Effect.flatMap((telemetry) => telemetry.latest),
        Effect.provide(makeTelemetryLayer(snapshot)),
      );
      const telemetryLayer = Layer.succeed(
        ResourceTelemetry.ResourceTelemetry,
        ResourceTelemetry.ResourceTelemetry.of({
          latest: Effect.succeed(staleTelemetry),
          changes: Stream.empty,
          subscribe: Effect.die("unused"),
          readHistory: () => Effect.die("unused"),
          refresh: Effect.fail(
            new ResourceTelemetry.ResourceTelemetryRefreshFailed({
              operation: "refresh",
              cause: new Error("collector unavailable"),
            }),
          ),
          validateProcessIdentity: () => Effect.die("unused"),
          retry: Effect.die("unused"),
        }),
      );
      const layer = ProcessDiagnostics.layer.pipe(
        Layer.provide(Layer.mergeAll(telemetryLayer, makeSupportLayers())),
      );

      const result = yield* Effect.service(ProcessDiagnostics.ProcessDiagnostics).pipe(
        Effect.flatMap((processDiagnostics) =>
          processDiagnostics.signal({
            pid: 4_242,
            startTimeMs: 2_000,
            signal: "SIGINT",
          }),
        ),
        Effect.provide(layer),
      );

      expect(result).toEqual({
        pid: 4_242,
        signal: "SIGINT",
        signaled: false,
        message: Option.some(
          "Could not refresh process 4242; refusing to signal a stale identity.",
        ),
      });
    }),
  );

  it.effect("rejects Electron processes as signal targets", () =>
    Effect.gen(function* () {
      const sampledAtUnixMs = DateTime.toEpochMillis(
        DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
      );
      const snapshot = makeNativeSnapshot([
        {
          pid: 4_242,
          ppid: 1,
          startTimeMs: 2_000,
          runTimeMs: 4_000,
          name: "electron",
          command: "electron",
          status: "Running",
          cpuPercent: 1.5,
          cpuTimeMs: 60,
          residentBytes: 2_048,
          virtualBytes: 4_096,
          ioReadBytes: 300,
          ioWriteBytes: 400,
          ioSemantics: "storage",
        },
      ]);
      const sampledAt = DateTime.makeUnsafe(sampledAtUnixMs);
      const telemetryLayer = makeTelemetryLayer(snapshot, {
        version: 1,
        type: "desktopTelemetry",
        sequence: 1,
        sampledAtUnixMs,
        electronPid: 4_242,
        power: {
          source: "electron-main",
          idle: "false",
          idleSeconds: 0,
          locked: "false",
          suspended: false,
          onBattery: "false",
          lowPowerMode: "unknown",
          thermalState: "nominal",
          stale: false,
          updatedAt: sampledAt,
        },
        speedLimitPercent: Option.none(),
        electronProcesses: [
          {
            pid: 4_242,
            creationTimeMs: 2_000,
            type: "Browser",
            name: "electron",
            cpuPercent: 1.5,
            idleWakeupsPerSecond: 0,
            workingSetBytes: 2_048,
            peakWorkingSetBytes: 2_048,
          },
        ],
      });
      const layer = ProcessDiagnostics.layer.pipe(
        Layer.provide(Layer.mergeAll(telemetryLayer, makeSupportLayers())),
      );

      const result = yield* Effect.service(ProcessDiagnostics.ProcessDiagnostics).pipe(
        Effect.flatMap((processDiagnostics) =>
          processDiagnostics.signal({
            pid: 4_242,
            startTimeMs: 2_000,
            signal: "SIGKILL",
          }),
        ),
        Effect.provide(layer),
      );

      expect(result).toEqual({
        pid: 4_242,
        signal: "SIGKILL",
        signaled: false,
        message: Option.some("Process 4242 is not a signalable T3 backend descendant."),
      });

      const diagnostics = yield* Effect.service(ProcessDiagnostics.ProcessDiagnostics).pipe(
        Effect.flatMap((processDiagnostics) => processDiagnostics.read),
        Effect.provide(layer),
      );
      expect(diagnostics.processes).toEqual([]);
      expect(diagnostics.processCount).toBe(0);
      expect(diagnostics.totalCpuPercent).toBe(0);
      expect(diagnostics.totalRssBytes).toBe(0);
    }),
  );
});
