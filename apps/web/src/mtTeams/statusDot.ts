import type { MtTeamsThreadStatus } from "./client";

/**
 * Shared-thread status → semantic dot color, mirroring the app's other status
 * dots (see ConnectionStatusDot). Static fills only: teammate activity is
 * ambient information, so no ping halo and no continuous animation.
 */
export function mtTeamsStatusDotClassName(status: MtTeamsThreadStatus): string {
  switch (status) {
    case "working":
      return "bg-blue-500";
    case "input-needed":
      return "bg-warning";
    case "done":
      return "bg-success";
    case "idle":
      return "bg-muted-foreground/40";
  }
}

export function mtTeamsStatusLabel(status: MtTeamsThreadStatus): string {
  switch (status) {
    case "working":
      return "Working";
    case "input-needed":
      return "Needs input";
    case "done":
      return "Done";
    case "idle":
      return "Idle";
  }
}
