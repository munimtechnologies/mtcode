import type { OrchestrationThreadGoal } from "@t3tools/contracts";
import { memo } from "react";

import { cn } from "~/lib/utils";

export const GoalChip = memo(function GoalChip({
  goal,
}: {
  readonly goal: OrchestrationThreadGoal | null | undefined;
}) {
  if (goal == null) {
    return null;
  }
  return (
    <span
      data-goal-chip
      title={goal.objective}
      className={cn(
        "inline-flex max-w-56 shrink-0 items-center rounded-md border border-border/80",
        "bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground",
      )}
    >
      <span className="truncate">{goal.objective}</span>
    </span>
  );
});
