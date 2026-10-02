import { buildThreadHandoffMarkdown } from "@t3tools/client-runtime/handoff";
import type { EnvironmentId, OrchestrationThread } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RunOnEnvironmentOption } from "../BranchToolbar.logic";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

export interface MoveThreadToComputerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sourceThread: OrchestrationThread;
  readonly sourceLabel: string;
  readonly computers: readonly RunOnEnvironmentOption[];
  /** The thread is mid-turn here, so offer to stop it once the move lands. */
  readonly sourceRunning: boolean;
  readonly onConfirm: (input: {
    readonly markdown: string;
    readonly targetEnvironmentId: EnvironmentId;
    readonly stopSource: boolean;
  }) => Promise<void> | void;
}

/**
 * Continues a thread on another computer: a new thread starts there with an
 * editable summary of this one. The original thread stays where it is.
 */
export function MoveThreadToComputerDialog({
  open,
  onOpenChange,
  sourceThread,
  sourceLabel,
  computers,
  sourceRunning,
  onConfirm,
}: MoveThreadToComputerDialogProps) {
  const [targetEnvironmentId, setTargetEnvironmentId] = useState<EnvironmentId | null>(
    computers[0]?.environmentId ?? null,
  );
  const target =
    computers.find((computer) => computer.environmentId === targetEnvironmentId) ??
    computers[0] ??
    null;
  const generate = useCallback(
    (to: string) =>
      buildThreadHandoffMarkdown({
        thread: sourceThread,
        targetModelSelection: sourceThread.modelSelection,
        machineChange: { from: sourceLabel, to },
      }),
    [sourceLabel, sourceThread],
  );
  const [markdown, setMarkdown] = useState(() => generate(target?.label ?? "another computer"));
  const editedRef = useRef(false);
  const [stopSource, setStopSource] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Keep the summary in step with the picked computer until the user edits it.
  useEffect(() => {
    if (!editedRef.current && target) setMarkdown(generate(target.label));
  }, [generate, target]);

  const items = useMemo(
    () => computers.map((computer) => ({ value: computer.environmentId, label: computer.label })),
    [computers],
  );

  const handleConfirm = useCallback(async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm({
        markdown,
        targetEnvironmentId: target.environmentId,
        stopSource: sourceRunning && stopSource,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [markdown, onConfirm, onOpenChange, sourceRunning, stopSource, submitting, target]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move to another computer</DialogTitle>
          <DialogDescription>
            Start a new thread on another computer with a summary of this one. This thread stays
            here.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-muted-foreground">From</span>
                <span className="text-sm font-semibold">{sourceLabel}</span>
              </div>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col items-end">
                <span className="text-xs font-medium text-muted-foreground">To</span>
                <Select
                  modal={false}
                  value={target?.environmentId ?? null}
                  onValueChange={(value) => {
                    if (value !== null) setTargetEnvironmentId(value as EnvironmentId);
                  }}
                  items={items}
                >
                  <SelectTrigger size="sm" aria-label="Target computer">
                    {target ? (
                      <EnvironmentMachineIcon kind={target.machine} className="size-3.5 shrink-0" />
                    ) : null}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {computers.map((computer) => (
                      <SelectItem key={computer.environmentId} value={computer.environmentId}>
                        <span className="inline-flex items-center gap-1.5">
                          <EnvironmentMachineIcon kind={computer.machine} className="size-3" />
                          {computer.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="move-thread-context-textarea"
                className="text-xs font-medium text-muted-foreground"
              >
                Summary for the new thread (editable)
              </label>
              <Textarea
                id="move-thread-context-textarea"
                value={markdown}
                onChange={(event) => {
                  editedRef.current = true;
                  setMarkdown(event.target.value);
                }}
                rows={12}
                size="sm"
              />
            </div>
            {sourceRunning ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={stopSource}
                  onCheckedChange={(checked) => setStopSource(checked === true)}
                />
                Stop the running turn on {sourceLabel}
              </label>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={submitting || !target || markdown.trim().length === 0}
            onClick={() => void handleConfirm()}
          >
            {submitting ? (
              <>
                <Spinner className="mr-2 size-4" />
                Moving…
              </>
            ) : (
              `Continue on ${target?.label ?? "computer"}`
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
