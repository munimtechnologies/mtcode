/**
 * Collapsible "Team" shelf under the sidebar thread list: teammates' shared
 * threads with a status dot, owner, and relative activity time. Clicking a row
 * opens a popover with a message box that posts into the owner's thread via
 * the team service. Renders nothing while signed out; header/toggle mirrors
 * the settled shelf's idiom. Status dots are static — no continuous animation.
 */
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import * as Schema from "effect/Schema";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { type MtTeamsSharedThread, sendMessage } from "./client";
import { getMtTeamsSession, useMtTeamsSelector, useMtTeamsSync } from "./state";
import { mtTeamsStatusDotClassName, mtTeamsStatusLabel } from "./statusDot";

const TEAM_SHELF_EXPANDED_KEY = "mtcode:sidebar:mt-teams-expanded";

function compactTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

export const MtTeamsSidebarSection = memo(function MtTeamsSidebarSection() {
  useMtTeamsSync();
  const signedIn = useMtTeamsSelector((state) => state.sessionToken.length > 0);
  const meUserId = useMtTeamsSelector((state) => state.me?.user.id ?? null);
  const sharedThreads = useMtTeamsSelector((state) => state.sharedThreads);
  const [expanded, setExpanded] = useLocalStorage(TEAM_SHELF_EXPANDED_KEY, true, Schema.Boolean);

  if (!signedIn) return null;

  const teammateThreads =
    meUserId === null
      ? sharedThreads
      : sharedThreads.filter((thread) => thread.ownerUserId !== meUserId);

  return (
    <div className="pb-1">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        data-testid="sidebar-mt-teams-shelf-toggle"
        className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
      >
        <span className="text-xs font-medium text-muted-foreground/50">
          {expanded || teammateThreads.length === 0 ? "Team" : `Team (${teammateThreads.length})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 text-muted-foreground/50 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        teammateThreads.length > 0 ? (
          <ul className="space-y-0.5">
            {teammateThreads.map((thread) => (
              <MtTeamsThreadRow key={thread.sharedThreadId} thread={thread} />
            ))}
          </ul>
        ) : (
          <p className="px-2.5 py-1 text-[11px] text-sidebar-muted-foreground/70">
            No teammate threads shared yet.
          </p>
        )
      ) : null}
    </div>
  );
});

const MtTeamsThreadRow = memo(function MtTeamsThreadRow({
  thread,
}: {
  readonly thread: MtTeamsSharedThread;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const send = async () => {
    if (pending || text.trim().length === 0) return;
    setPending(true);
    setFeedback(null);
    try {
      await sendMessage(getMtTeamsSession(), {
        sharedThreadId: thread.sharedThreadId,
        text: text.trim(),
      });
      setText("");
      setFeedback("Sent.");
    } catch (cause) {
      setFeedback(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Could not send the message.",
      );
    }
    setPending(false);
  };

  return (
    <li>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFeedback(null);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-sidebar-row-hover"
            />
          }
        >
          <span
            title={mtTeamsStatusLabel(thread.status)}
            className={cn("size-2 shrink-0 rounded-full", mtTeamsStatusDotClassName(thread.status))}
          />
          <span className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground">
            {thread.title}
          </span>
          <span className="shrink-0 text-[10px] text-sidebar-muted-foreground">
            {thread.ownerName}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-sidebar-muted-foreground/70">
            {compactTimeLabel(formatRelativeTimeLabel(thread.updatedAt))}
          </span>
        </PopoverTrigger>
        <PopoverPopup side="right" align="start" className="w-64">
          <div className="space-y-2 p-2">
            <div className="space-y-0.5">
              <p className="truncate text-xs font-medium text-foreground">{thread.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {thread.ownerName} · {thread.environmentLabel} · {mtTeamsStatusLabel(thread.status)}
              </p>
            </div>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={`Message ${thread.ownerName}…`}
              rows={3}
              size="sm"
            />
            {feedback ? <p className="text-[11px] text-muted-foreground">{feedback}</p> : null}
            <div className="flex justify-end">
              <Button
                size="xs"
                disabled={pending || text.trim().length === 0}
                onClick={() => void send()}
              >
                Send
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </li>
  );
});
