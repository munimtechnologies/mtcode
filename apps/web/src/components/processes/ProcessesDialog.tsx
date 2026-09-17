import type { ServerProcessDiagnosticsEntry, ServerProcessSignal } from "@t3tools/contracts";
import { RouterIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureLocalApi } from "~/localApi";
import { usePrimaryEnvironment } from "~/state/environments";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  formatBytes,
  groupProcesses,
  type ProcessWorkspace,
  processDisplayName,
  type ProcessGroup,
} from "./processGroups";

const REFRESH_INTERVAL_MS = 2_000;

/**
 * Chat-header entry to the Processes dialog: every process the agents and
 * terminals of this environment are running, grouped by the thread that owns
 * them, with a way to end one. Desktop only in practice: the list comes from
 * the resource monitor sidecar the desktop app ships.
 */
export function ProcessesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Processes"
              className="shrink-0 [-webkit-app-region:no-drag]"
              data-processes-button
              onClick={() => setOpen(true)}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <RouterIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Processes</TooltipPopup>
      </Tooltip>
      {open ? <ProcessesDialog onOpenChange={setOpen} /> : null}
    </>
  );
}

function ProcessesDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
  // Poll while open; the dialog is short-lived and the list changes as tools run.
  useEffect(() => {
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const shells = useThreadShells();
  const projects = useProjects();
  const threadTitleFor = useCallback(
    (threadId: string) => shells.find((shell) => shell.id === threadId)?.title ?? null,
    [shells],
  );
  // A listener's directory names its workspace: a thread's worktree beats the
  // project root it lives under, and the longest matching path wins.
  const workspaceFor = useCallback(
    (cwd: string): ProcessWorkspace | null => {
      const contains = (root: string) => cwd === root || cwd.startsWith(`${root}/`);
      const worktree = shells
        .flatMap((shell) =>
          shell.worktreePath !== null && contains(shell.worktreePath)
            ? [{ shell, worktreePath: shell.worktreePath }]
            : [],
        )
        .toSorted((left, right) => right.worktreePath.length - left.worktreePath.length)[0];
      if (worktree) {
        return { label: worktree.shell.title ?? "Untitled thread", threadId: worktree.shell.id };
      }
      const project = projects
        .filter((candidate) => contains(candidate.workspaceRoot))
        .toSorted((left, right) => right.workspaceRoot.length - left.workspaceRoot.length)[0];
      return project ? { label: project.title, threadId: null } : null;
    },
    [projects, shells],
  );
  const groups = useMemo(
    () => groupProcesses(data?.processes ?? [], threadTitleFor, workspaceFor),
    [data, threadTitleFor, workspaceFor],
  );

  const signalCommand = useAtomCommand(serverEnvironment.signalProcess, { reportFailure: false });
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const signalingRef = useRef<number | null>(null);
  const signal = useCallback(
    async (process: ServerProcessDiagnosticsEntry, kind: ServerProcessSignal) => {
      if (signalingRef.current !== null || environmentId === null) return;
      signalingRef.current = process.pid;
      setSignalingPid(process.pid);
      const done = () => {
        signalingRef.current = null;
        setSignalingPid(null);
      };
      if (kind === "SIGKILL") {
        let confirmed = false;
        try {
          confirmed = await ensureLocalApi().dialogs.confirm(
            `Force kill ${processDisplayName(process.command)} (PID ${process.pid})? The process gets no chance to clean up.`,
            { variant: "destructive" },
          );
        } catch {
          confirmed = false;
        }
        if (!confirmed) {
          done();
          return;
        }
      }
      const result = await signalCommand({
        environmentId,
        input: { pid: process.pid, startTimeMs: process.startTimeMs, signal: kind },
      });
      done();
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: `Could not signal PID ${process.pid}`,
          description: `Sending ${kind} failed.`,
        });
        return;
      }
      if (!result.value.signaled) {
        toastManager.add({
          type: "error",
          title: `PID ${process.pid} was not signaled`,
          description:
            result.value.message._tag === "Some" ? result.value.message.value : undefined,
        });
      }
      refresh();
    },
    [environmentId, refresh, signalCommand],
  );

  const total = data?.processes.length ?? 0;
  // The server reports why its process monitor has nothing, e.g. the sidecar
  // is missing outside the desktop app; say that instead of "nothing running".
  const monitorError = data && data.error._tag === "Some" ? data.error.value.message : null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RouterIcon className="size-4" />
            Processes
          </DialogTitle>
          <DialogDescription>
            {total === 0
              ? "Everything the agents and terminals of this environment are running. Nothing is running right now."
              : `${total} ${total === 1 ? "process" : "processes"} started by the agents and terminals of this environment, grouped by thread. Stop sends SIGINT; Kill sends SIGKILL.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {(error ?? monitorError) ? (
            <p className="text-sm text-destructive-foreground">{error ?? monitorError}</p>
          ) : isPending && data === null ? (
            <p className="text-sm text-muted-foreground">Reading processes…</p>
          ) : null}
          {groups.map((group) => (
            <ProcessGroupSection
              group={group}
              key={group.key}
              onSignal={signal}
              signalingPid={signalingPid}
            />
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ProcessGroupSection({
  group,
  signalingPid,
  onSignal,
}: {
  group: ProcessGroup;
  signalingPid: number | null;
  onSignal: (process: ServerProcessDiagnosticsEntry, signal: ServerProcessSignal) => void;
}) {
  return (
    <section className="rounded-xl border border-border/60" data-process-group={group.kind}>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <h3 className="truncate text-sm font-medium text-foreground">{group.label}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {group.processes.length} {group.processes.length === 1 ? "process" : "processes"}
        </span>
      </header>
      <ul className="divide-y divide-border/50">
        {group.processes.map((process) => (
          <ProcessRow
            key={`${process.pid}-${process.startTimeMs}`}
            onSignal={onSignal}
            process={process}
            signaling={signalingPid === process.pid}
          />
        ))}
      </ul>
    </section>
  );
}

function ProcessRow({
  process,
  signaling,
  onSignal,
}: {
  process: ServerProcessDiagnosticsEntry;
  signaling: boolean;
  onSignal: (process: ServerProcessDiagnosticsEntry, signal: ServerProcessSignal) => void;
}) {
  const name = processDisplayName(process.command);
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_3.5rem_auto] items-center gap-3 px-3 py-1.5 text-xs"
      style={{ paddingLeft: `${12 + Math.min(process.depth, 6) * 12}px` }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{name}</span>
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                PID {process.pid}
              </span>
              {process.port !== undefined ? (
                <span className="ml-2 font-mono text-[11px] text-primary">
                  localhost:{process.port}
                </span>
              ) : null}
            </span>
          }
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(520px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed"
        >
          {process.command}
          {process.cwd ? <div className="mt-1 text-muted-foreground">in {process.cwd}</div> : null}
        </TooltipPopup>
      </Tooltip>
      <span className="text-right tabular-nums text-muted-foreground">
        {process.cpuPercent.toFixed(process.cpuPercent >= 10 ? 0 : 1)}% CPU
      </span>
      <span className="text-right tabular-nums text-muted-foreground">
        {formatBytes(process.rssBytes)}
      </span>
      <span className="text-right tabular-nums text-muted-foreground">{process.elapsed}</span>
      <span className="flex items-center justify-end gap-1">
        <Button
          disabled={signaling}
          onClick={() => onSignal(process, "SIGINT")}
          size="xs"
          variant="ghost-muted"
        >
          Stop
        </Button>
        <Button
          className="text-destructive-foreground"
          disabled={signaling}
          onClick={() => onSignal(process, "SIGKILL")}
          size="xs"
          variant="ghost-muted"
        >
          Kill
        </Button>
      </span>
    </li>
  );
}
