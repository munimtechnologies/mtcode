import type { MtTeamsThreadStatus } from "./client";

/**
 * Shared-thread status → semantic dot color for uniwind class names, the
 * mobile port of web's mtTeamsStatusDotClassName. Static fills only:
 * teammate activity is ambient information, so no ping halo and no
 * continuous animation (animations peg the GPU on high-refresh displays).
 */
export function mtTeamsStatusDotClassName(status: MtTeamsThreadStatus): string {
  switch (status) {
    case "working":
      return "bg-blue-500";
    case "input-needed":
      return "bg-amber-500";
    case "done":
      return "bg-green-500";
    case "idle":
      return "bg-neutral-400 dark:bg-neutral-500";
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
