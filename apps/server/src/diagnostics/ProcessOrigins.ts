/**
 * Who started which process, for the Processes dialog (T3 Neo). Provider
 * runtimes and the terminal manager register the root process they spawn
 * with the thread it works for; the diagnostics reader then labels every
 * descendant in the sampled process tree by walking up to the nearest
 * registered ancestor. Claude Code is spawned by its SDK, so its session
 * registers a command-line token (the session id) instead of a pid.
 *
 * A plain module registry rather than a service: the spawn sites live in
 * layers built from very different graphs, and a pid is process-local anyway.
 */

import type { ServerProcessOrigin } from "@t3tools/contracts";

export type ProcessOrigin = ServerProcessOrigin;

const originsByPid = new Map<number, ProcessOrigin>();
const originsByCommandToken = new Map<string, ProcessOrigin>();

export function registerProcessOrigin(pid: number, origin: ProcessOrigin): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  originsByPid.set(pid, origin);
}

export function unregisterProcessOrigin(pid: number): void {
  originsByPid.delete(pid);
}

/** A process whose command line contains `token` (a session id) belongs to `origin`. */
export function registerCommandTokenOrigin(token: string, origin: ProcessOrigin): void {
  if (token.trim().length < 8) return;
  originsByCommandToken.set(token, origin);
}

export function unregisterCommandTokenOrigin(token: string): void {
  originsByCommandToken.delete(token);
}

export interface OriginResolvableProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

/**
 * Label each process: its own registration, else a command token, else the
 * origin of the nearest labelled ancestor within `processes`. Cycles and
 * unknown parents end the walk.
 */
export function resolveProcessOrigins(
  processes: ReadonlyArray<OriginResolvableProcess>,
): ReadonlyMap<number, ProcessOrigin> {
  const byPid = new Map(processes.map((process) => [process.pid, process] as const));
  const resolved = new Map<number, ProcessOrigin | null>();
  const tokens = [...originsByCommandToken.entries()];

  const own = (process: OriginResolvableProcess): ProcessOrigin | null => {
    const direct = originsByPid.get(process.pid);
    if (direct) return direct;
    for (const [token, origin] of tokens) {
      if (process.command.includes(token)) return origin;
    }
    return null;
  };

  const resolve = (pid: number, seen: Set<number>): ProcessOrigin | null => {
    const cached = resolved.get(pid);
    if (cached !== undefined) return cached;
    const process = byPid.get(pid);
    if (!process || seen.has(pid)) return null;
    seen.add(pid);
    const origin = own(process) ?? (process.ppid > 0 ? resolve(process.ppid, seen) : null);
    resolved.set(pid, origin);
    return origin;
  };

  const result = new Map<number, ProcessOrigin>();
  for (const process of processes) {
    const origin = resolve(process.pid, new Set());
    if (origin) result.set(process.pid, origin);
  }
  return result;
}

/** Test-only. */
export function resetProcessOriginsForTest(): void {
  originsByPid.clear();
  originsByCommandToken.clear();
}
