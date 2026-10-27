import { HourglassIcon, TimerResetIcon } from "lucide-react";

import { useDeadlinePassed } from "../../hooks/useDeadline";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { UsageLimitCountdown } from "./UsageLimitCountdown";

/**
 * The toggle for the usage-limit card: auto-resume on and back off. It mirrors the
 * server's own sweep; both dispatch an ordinary turn when the window passes.
 */
function UsageLimitAutoResumeAction(input: {
  readonly resetsAt: string;
  readonly autoResumeArmed: boolean;
  readonly onArmAutoResume: () => void;
  readonly onCancelAutoResume: () => void;
}) {
  const { resetsAt, autoResumeArmed, onArmAutoResume, onCancelAutoResume } = input;
  // Once the window passes the server would reject an arm; a new window re-arms it.
  const resetsAtMs = Date.parse(resetsAt);
  const windowPassed = useDeadlinePassed(Number.isFinite(resetsAtMs) ? resetsAtMs : null);
  return (
    <Button
      size="xs"
      variant="ghost"
      // An expired window can't fire an arm the server would reject, but an
      // armed thread must stay cancellable even then; only the unarmed
      // expired case disables the button.
      onClick={autoResumeArmed ? onCancelAutoResume : onArmAutoResume}
      disabled={windowPassed && !autoResumeArmed}
    >
      {autoResumeArmed
        ? "Auto-resume on (cancel)"
        : windowPassed
          ? "Window passed. Send a message to continue"
          : "Continue when tokens return"}
    </Button>
  );
}

/**
 * The one-tap "Snooze until <reset + 1 min>" offer that shares the card with
 * auto-resume. Snoozing is visibility-only (the thread parks out of the inbox
 * and wakes with the existing banner); the button is disabled, not hidden,
 * while the thread is temporarily unsnoozable so the wake time still reads.
 */
export interface UsageLimitSnoozeAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly onSnooze: () => void;
}

function UsageLimitSnoozeButton({ snooze }: { readonly snooze: UsageLimitSnoozeAction }) {
  const button = (
    <Button size="xs" variant="ghost" disabled={snooze.disabled} onClick={snooze.onSnooze}>
      {snooze.label}
    </Button>
  );
  if (!snooze.disabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{button}</span>} />
      <TooltipPopup side="top">Snoozing is unavailable while work is pending</TooltipPopup>
    </Tooltip>
  );
}

export function usageLimitBannerItem(input: {
  readonly threadId: string;
  readonly resetsAt: string;
  readonly autoResumeArmed: boolean;
  readonly onArmAutoResume: () => void;
  readonly onCancelAutoResume: () => void;
  /** Null when snoozing is unsupported, the thread is already snoozed, or the window passed. */
  readonly snooze?: UsageLimitSnoozeAction | null;
}): ComposerBannerStackItem {
  const { threadId, resetsAt, autoResumeArmed, onArmAutoResume, onCancelAutoResume, snooze } =
    input;
  return {
    id: `thread-usage-limit:${threadId}`,
    variant: "warning",
    icon: autoResumeArmed ? <TimerResetIcon /> : <HourglassIcon />,
    title: (
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">You've used all your plan usage</span>
        <span className="text-muted-foreground">
          · <UsageLimitCountdown resetsAt={resetsAt} />
        </span>
      </span>
    ),
    description: autoResumeArmed
      ? "This thread restarts on its own when the window resets."
      : "Tokens return when the window resets. You can also keep working on another plan.",
    actions: (
      <span className="flex flex-wrap items-center gap-1">
        <UsageLimitAutoResumeAction
          resetsAt={resetsAt}
          autoResumeArmed={autoResumeArmed}
          onArmAutoResume={onArmAutoResume}
          onCancelAutoResume={onCancelAutoResume}
        />
        {snooze ? <UsageLimitSnoozeButton snooze={snooze} /> : null}
      </span>
    ),
  };
}
