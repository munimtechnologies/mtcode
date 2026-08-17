import { memo } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

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
}: PullRequestUpstreamCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      onContextMenu={(event) => {
        event.preventDefault();
        void showPullRequestLinkContextMenu({
          url: entry.url,
          openLabel: openOnHostLabel(entry.provider),
          position: { x: event.clientX, y: event.clientY },
        });
      }}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left",
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
        <span className="min-w-0 flex-1 text-sm leading-snug font-medium break-words">
          {entry.title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTimeLabel(entry.updatedAt)}
        </span>
      </div>

      {reason ? (
        // The agent's own words, kept to one line: it is a hint about what the change does, not
        // a summary to be read instead of the pull request.
        <p className="line-clamp-1 pl-6 text-xs text-muted-foreground">{reason}</p>
      ) : null}

      <div className="flex min-w-0 items-center gap-2 pl-6 text-[11px] text-muted-foreground">
        <span className="shrink-0">#{entry.number}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{entry.repository}</span>
        {entry.author ? (
          <>
            <span aria-hidden>·</span>
            <PullRequestActorAvatar actor={entry.author} className="size-4 shrink-0" />
            <PullRequestActorLabel actor={entry.author} className="truncate" />
          </>
        ) : null}
      </div>
    </button>
  );
}

export const PullRequestUpstreamCard = memo(PullRequestUpstreamCardImpl);
