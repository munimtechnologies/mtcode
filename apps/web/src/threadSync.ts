import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";

export type ThreadSyncPhase = "loading" | "syncing" | "reconnecting";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
  /**
   * The thread subscription's last failure, if it is still unresolved. A failed
   * subscription leaves the status on "cached"/"empty" and retries a few times a
   * second, which is indistinguishable from a slow first sync — so without this
   * a thread whose stream keeps erroring shows "Syncing messages..." forever and
   * never says why.
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

export function threadSyncLabel(phase: ThreadSyncPhase): string {
  switch (phase) {
    case "loading":
      return "Loading messages...";
    case "syncing":
      return "Syncing messages...";
    case "reconnecting":
      return "Reconnecting...";
  }
}
