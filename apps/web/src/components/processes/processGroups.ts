import type { ServerProcessDiagnosticsEntry } from "@t3tools/contracts";

import { APP_BASE_NAME } from "~/branding";
import { providerDisplayName } from "~/lib/providerDisplayName";

export type ProcessGroupKind = "provider" | "terminal" | "listener" | "server";

/** Which workspace a process's working directory falls into: a thread's worktree or a project. */
export interface ProcessWorkspace {
  readonly label: string;
  readonly threadId: string | null;
}

export interface ProcessGroup {
  readonly key: string;
  readonly kind: ProcessGroupKind;
  /** "Claude · Fix the login bug", "Terminal · Fix the login bug", "<app> server helpers". */
  readonly label: string;
  readonly threadId: string | null;
  readonly processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
}

const SERVER_GROUP_KEY = "server";

export const SERVER_HELPERS_GROUP_LABEL = `${APP_BASE_NAME} server helpers`;

/**
 * Bucket the server's process list by where each process came from, keeping
 * the server's tree order inside a bucket so indentation still reads. Thread
 * groups come first (agents, then that thread's terminal), then dev servers
 * found by their ports (grouped by the workspace their directory falls into),
 * the server's own helpers last.
 */
export function groupProcesses(
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>,
  threadTitleFor: (threadId: string) => string | null,
  workspaceFor: (cwd: string) => ProcessWorkspace | null = () => null,
): ReadonlyArray<ProcessGroup> {
  const groups = new Map<string, ProcessGroup & { processes: ServerProcessDiagnosticsEntry[] }>();
  for (const process of processes) {
    const origin = process.origin;
    const workspace =
      origin?.kind === "listener" && process.cwd !== undefined ? workspaceFor(process.cwd) : null;
    const key =
      origin?.kind === "listener"
        ? `listener:${workspace?.threadId ?? workspace?.label ?? ""}`
        : origin
          ? `${origin.kind}:${origin.provider ?? ""}:${origin.threadId ?? origin.providerInstanceId ?? ""}`
          : SERVER_GROUP_KEY;
    let group = groups.get(key);
    if (!group) {
      const threadId = origin?.threadId ?? workspace?.threadId ?? null;
      const threadTitle = threadId ? threadTitleFor(threadId) : null;
      const who =
        origin?.kind === "listener"
          ? "Dev servers"
          : origin?.kind === "terminal"
            ? "Terminal"
            : origin
              ? (providerDisplayName(origin.provider ?? null) ?? "Agent")
              : null;
      const where =
        origin?.kind === "listener"
          ? (workspace?.label ?? "Unknown workspace")
          : (threadTitle ?? (threadId ? "Untitled thread" : "No thread"));
      group = {
        key,
        kind: origin?.kind ?? "server",
        label: who ? `${who} · ${where}` : SERVER_HELPERS_GROUP_LABEL,
        threadId,
        processes: [],
      };
      groups.set(key, group);
    }
    group.processes.push(process);
  }
  const rank = (group: ProcessGroup) =>
    group.kind === "provider"
      ? 0
      : group.kind === "terminal"
        ? 1
        : group.kind === "listener"
          ? 2
          : 3;
  return [...groups.values()].toSorted((left, right) => {
    const byKind = rank(left) - rank(right);
    return byKind !== 0 ? byKind : left.label.localeCompare(right.label);
  });
}

/** "codex" from a full command line, without its directory. */
export function processDisplayName(command: string): string {
  const [firstToken] = command.trim().split(/\s+/);
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const lastSegment = normalized.split(/[\\/]/).findLast((segment) => segment.length > 0);
  return lastSegment ?? normalized;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
