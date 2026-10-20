// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off globalTimers:off - test-only probes of the host process table and of fixture processes after their parent exits.
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

const POLL_INTERVAL_MS = 10;

/**
 * Polls `read` on native time until it returns a value or `timeoutMs` passes.
 * A test clock does not move the host, so a process that is really starting
 * or exiting has to be observed against the wall clock.
 */
const pollNative = <A>(
  read: () => A | undefined,
  timeoutMs: number,
): Effect.Effect<A | undefined> =>
  Effect.callback<A | undefined>((resume) => {
    const deadline = Date.now() + timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const poll = () => {
      const value = read();
      if (value !== undefined || Date.now() >= deadline) {
        resume(Effect.succeed(value));
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return Effect.sync(() => clearTimeout(timer));
  });

/** Whether the host still has a process with this id. A reaped process is gone. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Best-effort SIGKILL so a failing assertion does not leave a helper behind. */
export function killQuietly(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** Resolves `true` once the process is gone, or `false` if it is still alive after `timeoutMs`. */
export const waitForProcessExit = (pid: number, timeoutMs = 5_000): Effect.Effect<boolean> =>
  pollNative(() => (isProcessAlive(pid) ? undefined : true), timeoutMs).pipe(
    Effect.map((gone) => gone === true),
  );

/** Reads the pid a stub wrote to `path`, waiting up to `timeoutMs` for the file to appear. */
export const readPidFile = (path: string, timeoutMs = 5_000): Effect.Effect<number | undefined> =>
  pollNative(() => {
    try {
      const pid = Number(NodeFS.readFileSync(path, "utf8").trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }, timeoutMs);

export const makeProcessProbe = Effect.gen(function* () {
  const started = yield* Deferred.make<number>();
  const exited = yield* Deferred.make<void>();
  const sockets = new Set<NodeNet.Socket>();
  const server = NodeNet.createServer((socket) => {
    sockets.add(socket);
    let output = "";
    socket.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("\n")) {
        const pid = Number(output.trim());
        if (Number.isSafeInteger(pid) && pid > 0) {
          Deferred.doneUnsafe(started, Effect.succeed(pid));
        }
      }
    });
    socket.on("close", () => {
      sockets.delete(socket);
      Deferred.doneUnsafe(exited, Effect.void);
    });
  });
  yield* Effect.acquireRelease(
    Effect.callback<void, Error>((resume) => {
      server.once("error", (error) => resume(Effect.fail(error)));
      server.listen(0, "127.0.0.1", () => resume(Effect.void));
    }),
    () =>
      Effect.sync(() => {
        for (const socket of sockets) socket.destroy();
        server.close();
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    return yield* Effect.die("Missing process probe port");
  }
  return {
    port: address.port,
    started: Deferred.await(started).pipe(
      Effect.timeout("4 seconds"),
      TestClock.withLive,
      Effect.tap((pid) =>
        Effect.addFinalizer(() =>
          Effect.gen(function* () {
            if (yield* Deferred.isDone(exited)) return;
            // Only a PID reported by this fixture is eligible for failure cleanup.
            yield* Effect.sync(() => {
              try {
                process.kill(pid, "SIGKILL");
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
              }
            });
          }),
        ),
      ),
    ),
    exited: Deferred.await(exited).pipe(Effect.timeout("4 seconds"), TestClock.withLive),
  };
});

export const processProbeSource = (port: number) => `
  const { createConnection } = await import("node:net");
  const probe = createConnection(${port}, "127.0.0.1", () => {
    probe.write(process.pid + "\\n");
  });
`;
