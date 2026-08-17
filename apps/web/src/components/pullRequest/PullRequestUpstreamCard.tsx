import { SparklesIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
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
  /** True while a hand-off this card started is still opening its thread. */
  readonly implementing: boolean;
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
  implementing,
}: PullRequestUpstreamCardProps) {
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
      </div>

      {reason ? (
        // The agent's own words, kept to one line: it is a hint about what the change does, not
        // a summary to be read instead of the pull request.
        <p className="line-clamp-1 pl-6 text-xs text-muted-foreground">{reason}</p>
      ) : null}

      <div className="flex min-w-0 items-center gap-1.5 pl-6 text-[11px] text-muted-foreground">
        <span className="shrink-0">#{entry.number}</span>
        {entry.author ? (
          <>
            <PullRequestActorAvatar actor={entry.author} className="size-4 shrink-0" />
            <PullRequestActorLabel actor={entry.author} className="truncate" />
          </>
        ) : null}
        <span className="ml-auto shrink-0">{formatRelativeTimeLabel(entry.updatedAt)}</span>
        {/* On the meta line rather than a band across the card: it is one action among the row's
            details, and given its own full-width row it read as the card's purpose rather than a
            shortcut. Stops the click from also opening the row underneath it. */}
        <Button
          size="xs"
          variant="ghost"
          className="h-5 shrink-0 gap-1 px-1.5 text-[11px] font-normal"
          disabled={implementing}
          onClick={(event) => {
            event.stopPropagation();
            onImplement(entry);
          }}
        >
          {implementing ? (
            "Opening..."
          ) : (
            <>
              <SparklesIcon className="size-3" />
              Implement
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export const PullRequestUpstreamCard = memo(PullRequestUpstreamCardImpl);
