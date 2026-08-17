import type { OrchestrationThreadGoal } from "@t3tools/contracts";
import { memo } from "react";

import { GoalChip, type GoalChipAction } from "./GoalChip";

/**
 * Objective pill perched on the composer's top-left shoulder (mirrors the stash
 * badge on the right). Text click edits the Goal via the composer; the icons
 * pause, resume, or delete it.
 */
export const ComposerGoalBadge = memo(function ComposerGoalBadge(props: {
  readonly goal: OrchestrationThreadGoal | null | undefined;
  readonly isWorking?: boolean;
  readonly onAction?: ((action: GoalChipAction) => void) | undefined;
  readonly onEdit?: ((objective: string) => void) | undefined;
}) {
  if (props.goal == null) {
    return null;
  }

  return (
    <div className="absolute -top-3 left-4 z-10" data-composer-goal-badge="true">
      <GoalChip
        goal={props.goal}
        isWorking={props.isWorking === true}
        onAction={props.onAction}
        onEdit={props.onEdit}
      />
    </div>
  );
});
