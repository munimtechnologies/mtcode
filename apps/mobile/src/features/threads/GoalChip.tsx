import type { OrchestrationThreadGoal } from "@t3tools/contracts";
import { truncateGoalObjectivePreview } from "@t3tools/shared/composerTrigger";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";

type GoalChipGoal =
  | OrchestrationThreadGoal
  | { readonly objectivePreview: string; readonly status: string };

function goalChipLabel(goal: GoalChipGoal): string {
  const objective = "objective" in goal ? goal.objective : goal.objectivePreview;
  return truncateGoalObjectivePreview(objective);
}

export function GoalChip({ goal }: { readonly goal: GoalChipGoal | null | undefined }) {
  if (goal == null) {
    return null;
  }

  const label = goalChipLabel(goal);

  return (
    <View className="px-4 pb-2" accessibilityLabel={`Objective: ${label}`}>
      <View className="self-start max-w-[80%] rounded-md border border-border bg-card px-2 py-1">
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}
