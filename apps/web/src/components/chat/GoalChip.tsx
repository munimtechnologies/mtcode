import type { OrchestrationThreadGoal } from "@t3tools/contracts";
import {
  formatGoalStatusLabel,
  GOAL_PAUSE_HINT,
  goalChipActionLabel,
  goalChipActions,
  threadHasActiveGoal,
  type GoalChipAction,
} from "@t3tools/shared/composerTrigger";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Menu, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

export type { GoalChipAction };

function goalStatusClass(status: string): string {
  if (status === "blocked") {
    return "text-destructive";
  }
  if (status === "usageLimited") {
    return "text-warning-foreground";
  }
  return "text-muted-foreground";
}

export const GoalActiveMarker = memo(function GoalActiveMarker({
  goal,
}: {
  readonly goal: { readonly status: string } | null | undefined;
}) {
  if (!threadHasActiveGoal(goal)) {
    return null;
  }
  return (
    <span
      data-goal-active
      className="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
    >
      Active
    </span>
  );
});

export const GoalChip = memo(function GoalChip({
  goal,
  onAction,
}: {
  readonly goal: OrchestrationThreadGoal | null | undefined;
  readonly onAction?: ((action: GoalChipAction) => void) | undefined;
}) {
  if (goal == null) {
    return null;
  }
  const statusLabel = formatGoalStatusLabel(goal.status);
  const actions = goalChipActions(goal.status);
  const label = `${statusLabel}: ${goal.objective}`;

  if (onAction == null) {
    return (
      <span
        data-goal-chip
        title={label}
        className={cn(
          "inline-flex max-w-56 shrink-0 items-center gap-1.5 rounded-md border border-border/80",
          "bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground",
        )}
      >
        <span className={cn("shrink-0 font-medium", goalStatusClass(goal.status))}>
          {statusLabel}
        </span>
        <span className="truncate">{goal.objective}</span>
      </span>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            data-goal-chip
            aria-label={label}
            title={label}
            className={cn(
              "inline-flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/80",
              "bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground",
              "hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        }
      >
        <span className={cn("shrink-0 font-medium", goalStatusClass(goal.status))}>
          {statusLabel}
        </span>
        <span className="truncate">{goal.objective}</span>
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        {goal.status === "active" ? (
          <MenuGroupLabel className="max-w-64 text-wrap font-normal leading-snug">
            {GOAL_PAUSE_HINT}
          </MenuGroupLabel>
        ) : null}
        {actions.map((action) => (
          <MenuItem
            key={action}
            variant={action === "clear" ? "destructive" : "default"}
            onClick={() => {
              onAction(action);
            }}
          >
            {goalChipActionLabel(action)}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
});
