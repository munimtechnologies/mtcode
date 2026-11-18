import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import { msg } from "gt-react";

import { m, type MessageResolver } from "./i18n/messages";

export type ThreadSyncPhase = "loading" | "syncing" | "reconnecting";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
  /**
   * The thread subscription's unresolved failure. A failed subscription stays on
   * "cached"/"empty" while it retries, so without this a broken stream would show
   * "Syncing messages..." forever.
   */
  readonly hasError?: boolean;
}): ThreadSyncPhase | null {
  if (!input.shellExists) {
    return null;
  }

  switch (input.status) {
    case "empty":
    case "cached":
    case "synchronizing":
      return input.hasError === true ? "reconnecting" : input.detailExists ? "syncing" : "loading";
    case "deleted":
    case "live":
      return null;
  }
}

export function threadSyncLabel(phase: ThreadSyncPhase, resolve: MessageResolver = m): string {
  switch (phase) {
    case "loading":
      return resolve(msg("Loading messages..."));
    case "syncing":
      return resolve(msg("Syncing messages..."));
    case "reconnecting":
      return resolve(msg("Reconnecting..."));
  }
}
