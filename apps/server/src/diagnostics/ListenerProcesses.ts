import type { DiscoveredLocalServer } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type * as ProcessRunner from "../processRunner.ts";

/**
 * Dev servers the agents leave running in the background detach from the
 * server's process tree: their shell exits and launchd adopts them, so the
 * resource monitor never sees them. They are still on the machine's listening
 * ports. This reads the listeners PortDiscovery finds that the tree lacks,
 * with the working directory that tells the client which workspace they
 * belong to. Unix only; Windows has neither `ps` nor `lsof`.
 */

const PROBE_TIMEOUT_MS = 2_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

export interface ListenerProcess {
  readonly pid: number;
  readonly ppid: number;
  /** Rounded to whole seconds: `ps` reports elapsed time, not a start stamp. */
  readonly startTimeMs: number;
  readonly runTimeMs: number;
  readonly command: string;
  readonly status: string;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly cwd: string | null;
  readonly ports: ReadonlyArray<number>;
}

/** Two listener identities agree when their rounded start stamps sit within this. */
export const LISTENER_START_TOLERANCE_MS = 2_000;

/** "[[dd-]hh:]mm:ss" from `ps -o etime` to milliseconds. */
export function parseElapsed(raw: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 3_600 +
      Number(minutes) * 60 +
      Number(seconds)) *
    1_000
  );
}

export interface PsRow {
  readonly pid: number;
  readonly ppid: number;
  readonly runTimeMs: number;
  readonly rssBytes: number;
  readonly cpuPercent: number;
  readonly status: string;
  readonly command: string;
}

/** Rows of `ps -o pid=,ppid=,etime=,rss=,%cpu=,stat=,command=`. */
export function parsePsOutput(raw: string): ReadonlyMap<number, PsRow> {
  const rows = new Map<number, PsRow>();
  for (const line of raw.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const runTimeMs = parseElapsed(match[3]!);
    if (runTimeMs === null) continue;
    const pid = Number(match[1]);
    rows.set(pid, {
      pid,
      ppid: Number(match[2]),
      runTimeMs,
      rssBytes: Number(match[4]) * 1024,
      cpuPercent: Number(match[5]),
      status: match[6]!,
      command: match[7]!.trim(),
    });
  }
  return rows;
}

/** `lsof -a -d cwd -F pn -p …`: a `p<pid>` line, then `n<path>` for its cwd. */
export function parseCwdOutput(raw: string): ReadonlyMap<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("p")) {
      const parsed = Number.parseInt(line.slice(1), 10);
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } else if (line.startsWith("n") && pid !== null && !cwds.has(pid)) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

/** The listeners whose pid the sampled tree does not contain, with their details. */
export const readListenerProcesses = Effect.fn("readListenerProcesses")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  servers: ReadonlyArray<DiscoveredLocalServer>,
  knownPids: ReadonlySet<number>,
  nowMs: number,
) {
  const platform = yield* HostProcessPlatform;
  if (platform === "win32") return [] as ReadonlyArray<ListenerProcess>;
  const portsByPid = new Map<number, number[]>();
  for (const server of servers) {
    if (server.pid === null || knownPids.has(server.pid)) continue;
    const ports = portsByPid.get(server.pid) ?? [];
    ports.push(server.port);
    portsByPid.set(server.pid, ports);
  }
  if (portsByPid.size === 0) return [] as ReadonlyArray<ListenerProcess>;

  const pids = [...portsByPid.keys()].join(",");
  const probe = (command: string, args: ReadonlyArray<string>) =>
    runner
      .run({
        command,
        args,
        timeout: Duration.millis(PROBE_TIMEOUT_MS),
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((result) => result.stdout),
        Effect.catch((cause) =>
          Effect.logDebug("listener process probe failed", { command, cause }).pipe(Effect.as("")),
        ),
      );
  const rows = parsePsOutput(
    yield* probe("ps", ["-o", "pid=,ppid=,etime=,rss=,%cpu=,stat=,command=", "-p", pids]),
  );
  const cwds = parseCwdOutput(yield* probe("lsof", ["-a", "-d", "cwd", "-F", "pn", "-p", pids]));

  const listeners: ListenerProcess[] = [];
  for (const [pid, ports] of portsByPid) {
    const row = rows.get(pid);
    if (!row) continue;
    listeners.push({
      ...row,
      startTimeMs: Math.round((nowMs - row.runTimeMs) / 1_000) * 1_000,
      cwd: cwds.get(pid) ?? null,
      ports: ports.toSorted((left, right) => left - right),
    });
  }
  return listeners as ReadonlyArray<ListenerProcess>;
});
