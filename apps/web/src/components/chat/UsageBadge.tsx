import { memo } from "react";

import { cn } from "~/lib/utils";
import { formatTurnUsage, type TurnUsage } from "~/turnUsage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * A badge under an assistant reply: what the turn cost. Green on a free plan,
 * red over the limit, accent-tinted otherwise; nothing when there is nothing to say.
 */
export const UsageBadge = memo(function UsageBadge({
  usage,
  planLabel = null,
}: {
  usage: TurnUsage;
  /** Plan or provider name appended to limit-based headlines. */
  planLabel?: string | null;
}) {
  const formatted = formatTurnUsage(usage, planLabel);
  if (formatted === null) return null;
  const { headline, detail, tone } = formatted;
  const pill = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[0.375rem] border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "overage"
          ? "border-destructive/40 bg-destructive/15 text-destructive-foreground"
          : tone === "free"
            ? "border-success/40 bg-success/12 text-success-foreground"
            : "border-primary/35 bg-primary/12 text-foreground/85",
      )}
      data-usage-badge={tone}
    >
      {headline}
    </span>
  );
  if (!detail) return pill;
  return (
    <Tooltip>
      <TooltipTrigger render={pill} />
      <TooltipPopup side="top">{detail}</TooltipPopup>
    </Tooltip>
  );
});
