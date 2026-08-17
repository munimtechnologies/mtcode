import { GitBranchPlusIcon, LoaderIcon, SparklesIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { openOnHostLabel, showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";
import {
  PullRequestActorAvatar,
  PullRequestActorLabel,
  PullRequestStateGlyph,
} from "./pullRequestPresentation";

interface PullRequestUpstreamCardProps {
  readonly entry: EnvironmentPullRequestEntry;
  /** What an agent made of it, where it has been judged. */
  readonly reason?: string | undefined;
  readonly selected: boolean;
  readonly onSelect: (entry: EnvironmentPullRequestEntry) => void;
  /** Port this change into the project the row was read through. */
  readonly onImplement: (entry: EnvironmentPullRequestEntry) => void;
  /** Take the change's own commits onto a branch of their own, in a worktree of its own. */
  readonly onCherryPick: (entry: EnvironmentPullRequestEntry) => void;
  /** True while a hand-off this card started is still opening its thread. */
  readonly implementing: boolean;
  /** True while this card's pick is still fetching, branching and applying. */
  readonly picking: boolean;
}

/**
 * One upstream pull request, drawn as a card rather than a list row.
 *
 * A row is for scanning a queue of work that is already yours; these are somebody else's changes
 * being weighed up, so the card gives the title room to be read and carries the agent's reason
 * for rating it underneath — which is the part that answers "should I take this one".
 */
function PullRequestUpstreamCardImpl({
  entry,
  reason,
  selected,
  onSelect,
  onImplement,
  onCherryPick,
  implementing,
  picking,
}: PullRequestUpstreamCardProps) {
  const busy = implementing || picking;
  return (
    // A div rather than a button: the card carries a button of its own, and a button inside a
    // button is neither valid nor operable by keyboard. The role and key handling put back what
    // the element gave for free.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(entry);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void showPullRequestLinkContextMenu({
          url: entry.url,
          openLabel: openOnHostLabel(entry.provider),
          position: { x: event.clientX, y: event.clientY },
        });
      }}
      className={cn(
        "flex h-full w-full flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left",
        "transition-colors hover:border-border hover:bg-accent/40",
        selected && "border-primary/50 bg-accent/60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <PullRequestStateGlyph
          state={entry.state}
          isDraft={entry.isDraft}
          mergeability={entry.mergeability}
          baseBranch={entry.baseBranch}
          className="mt-0.5 shrink-0"
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium">
          {entry.title}
        </span>
        {/* Top right, outlined: the corner is where an action on a card is looked for, and a
            ghost icon among muted metadata read as another detail rather than something to
            press. Both stop the click from also opening the row underneath.

            Taking the commits comes first because it is what somebody watching an upstream
            usually wants; reimplementing is for the change whose code will not travel. */}
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  className="size-6 shrink-0"
                  aria-label={`Cherry-pick pull request #${entry.number} into this project`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCherryPick(entry);
                  }}
                >
                  {picking ? (
                    <LoaderIcon aria-hidden className="size-3.5 animate-spin" />
                  ) : (
                    <GitBranchPlusIcon className="size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipPopup>
              {picking ? "Cherry-picking..." : "Cherry-pick onto a branch of its own"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  className="size-6 shrink-0"
                  aria-label={`Implement pull request #${entry.number} in this project`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onImplement(entry);
                  }}
                >
                  {implementing ? (
                    <LoaderIcon aria-hidden className="size-3.5 animate-spin" />
                  ) : (
                    <SparklesIcon className="size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipPopup>
              {implementing ? "Opening a thread..." : "Implement in this project"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {reason ? (
        // The agent's own words, kept to one line: it is a hint about what the change does, not
        // a summary to be read instead of the pull request.
        <p className="line-clamp-1 text-xs text-muted-foreground">{reason}</p>
      ) : null}

      <div className="mt-auto flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="shrink-0">#{entry.number}</span>
        {entry.author ? (
          <>
            <PullRequestActorAvatar actor={entry.author} className="size-4 shrink-0" />
            <PullRequestActorLabel actor={entry.author} className="truncate" />
          </>
        ) : null}
        <span className="ml-auto shrink-0">{formatRelativeTimeLabel(entry.updatedAt)}</span>
      </div>
    </div>
  );
}

export const PullRequestUpstreamCard = memo(PullRequestUpstreamCardImpl);
