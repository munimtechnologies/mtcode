import type { UsageDay } from "@t3tools/contracts";
import { GaugeIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { providerDisplayName } from "~/lib/providerDisplayName";
import { cn } from "~/lib/utils";
import { useUsage } from "~/state/usage";
import { formatPercent, formatResetIn, formatTokens, type TurnUsage } from "~/turnUsage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The current minute, so reset countdowns tick while the card is open and never faster. */
function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A small pill after a window label: how long until that window resets. */
function ResetBadge({ resetsAt, now }: { resetsAt: string; now: number }) {
  const remaining = formatResetIn(resetsAt, now);
  if (remaining === null) return null;
  return (
    <span
      className="inline-flex items-center rounded-[0.375rem] border border-primary/35 bg-primary/12 px-[5px] text-[10px] font-semibold leading-[15px] tabular-nums text-muted-foreground"
      aria-label={`resets in ${remaining}`}
    >
      {remaining}
    </span>
  );
}

function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground [&:not(:first-child)]:mt-2">
      {children}
    </h4>
  );
}

const ROW_CLASS = "flex items-center justify-between gap-3";

function usageDay(date: Date): UsageDay {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as UsageDay;
}

/** The current calendar month, the closest thing to a billing cycle every provider shares. */
function currentMonthWindow() {
  const now = new Date();
  return {
    sinceDay: usageDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    untilDay: usageDay(now),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    resolution: "day" as const,
  };
}

function formatUsd(value: number): string {
  return value < 0.005 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
}

/** The hover card body: every plan window, the last turn, and this month's spending. */
function UsageCard({
  usage,
  providerName,
  overage,
  limited,
}: {
  usage: TurnUsage | null;
  providerName: string | null;
  overage: boolean;
  /** The plan refused the last turn without billing overage. */
  limited: boolean;
}) {
  const window = useMemo(currentMonthWindow, []);
  const { merged, isPending } = useUsage(window);
  const now = useMinuteNow();
  return (
    <div className="w-max min-w-60 max-w-[22rem] px-3 py-2.5 text-left text-xs leading-[1.4] text-foreground [text-wrap:initial]">
      <CardHeading>{providerName ? `${providerName} Limits` : "Plan Limits"}</CardHeading>
      {usage?.provider === "cursor" ? (
        // Cursor reports no windows; its only "window" is the synthetic full
        // one behind the reply badge, and a bar for that would claim a number.
        <div className="text-muted-foreground">Cursor does not report usage or reset times.</div>
      ) : usage && usage.windows.length > 0 ? (
        usage.windows.map((window) => (
          <div key={window.label} className="mb-1.5">
            <div className={ROW_CLASS}>
              <span className="inline-flex items-center gap-1.5">
                {window.label}
                {window.resetsAt ? <ResetBadge resetsAt={window.resetsAt} now={now} /> : null}
              </span>
              <span className="tabular-nums">{formatPercent(window.usedPercent)} used</span>
            </div>
            <div className="mt-[3px] h-1 overflow-hidden rounded-full bg-primary/20" aria-hidden>
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, Math.min(100, window.usedPercent))}%` }}
              />
            </div>
          </div>
        ))
      ) : (
        <div className="text-muted-foreground">Nothing reported yet.</div>
      )}
      {usage &&
      (usage.inputTokens !== null ||
        usage.outputTokens !== null ||
        usage.totalCostUsd !== null ||
        usage.windowDeltaPercent !== null) ? (
        <>
          <CardHeading>Last turn</CardHeading>
          <div className={ROW_CLASS}>
            <span>
              {formatTokens(usage.inputTokens ?? 0)} in / {formatTokens(usage.outputTokens ?? 0)}{" "}
              out
            </span>
            {usage.windowDeltaPercent !== null ? (
              <span className="tabular-nums">
                {formatPercent(usage.windowDeltaPercent)} of {usage.windowLabel ?? "Limit"}
              </span>
            ) : usage.totalCostUsd !== null ? (
              <span className="tabular-nums">{formatUsd(usage.totalCostUsd)}</span>
            ) : null}
          </div>
          {overage ? (
            <div className="text-destructive-foreground">Billed over the limit.</div>
          ) : limited ? (
            <div className="text-destructive-foreground">
              The last reply said the plan limit was reached.
            </div>
          ) : null}
        </>
      ) : null}
      <CardHeading>This month</CardHeading>
      {isPending ? (
        <div className="text-muted-foreground">Adding up local transcripts…</div>
      ) : merged.providers.length === 0 ? (
        <div className="text-muted-foreground">No recorded spending yet.</div>
      ) : (
        <>
          {merged.providers.map((provider) => (
            <div key={provider.provider} className={ROW_CLASS}>
              <span>{providerDisplayName(provider.provider)}</span>
              <span className="tabular-nums">
                {formatUsd(provider.costUsd)} · {formatTokens(provider.totalTokens)} tok
              </span>
            </div>
          ))}
          <div className={cn(ROW_CLASS, "mt-1 border-t border-border pt-1 font-medium")}>
            <span>Total</span>
            <span className="tabular-nums">
              {formatUsd(merged.costUsd)} · {formatTokens(merged.totalTokens)} tok
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A pill next to the composer controls with the plan window that is filling
 * up right now, from the newest usage report in this thread. Hovering lifts a
 * card (a portaled tooltip, so the composer's clipping never hides it) with
 * every reported window and the month's spending.
 */
export const ComposerUsageBadge = memo(function ComposerUsageBadge({
  usage,
  planLabel,
}: {
  usage: TurnUsage | null;
  planLabel: string | null;
}) {
  const providerName = usage ? (planLabel ?? providerDisplayName(usage.provider)) : planLabel;
  const tightest = usage?.windows[0] ?? null;
  const overage = usage?.billing === "overage";
  const limited = usage?.billing === "limited";

  // A refused turn says nothing about the state right now (Cursor reports no
  // usage), so the live pill admits that instead of claiming a full window.
  const headline = limited
    ? "Limit Unknown"
    : tightest
      ? // The percent alone; the window's name is in the hover card, and the
        // pill has no room to wrap.
        formatPercent(tightest.usedPercent)
      : usage?.totalCostUsd !== null && usage?.totalCostUsd !== undefined
        ? `${formatUsd(usage.totalCostUsd)} last turn`
        : "Usage";

  return (
    <Tooltip>
      <TooltipTrigger
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[var(--control-radius)] border px-2.5 text-[11px] font-medium tabular-nums transition-colors",
              overage
                ? "border-destructive/45 bg-destructive/15 text-destructive-foreground"
                : "border-primary/40 bg-primary/12 text-foreground/85 hover:bg-primary/20",
            )}
            aria-label={`Current usage: ${headline}`}
            data-usage-live={overage ? "overage" : tightest ? "limit" : "none"}
          />
        }
      >
        <GaugeIcon className="size-3.5 text-primary" />
        <span>{headline}</span>
      </TooltipTrigger>
      <TooltipPopup side="top" sideOffset={10} className="[&_[data-slot=tooltip-viewport]]:p-0">
        <UsageCard usage={usage} providerName={providerName} overage={overage} limited={limited} />
      </TooltipPopup>
    </Tooltip>
  );
});
