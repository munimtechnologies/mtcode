import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface SessionStartupReconcilerShape {
  /**
   * Settle sessions the read model considers live but whose provider process
   * did not survive the last shutdown. Runs once during startup, after the
   * projection pipeline is bootstrapped and before commands are accepted.
   */
  readonly reconcile: () => Effect.Effect<void>;
}

export class SessionStartupReconciler extends Context.Service<
  SessionStartupReconciler,
  SessionStartupReconcilerShape
>()("t3/provider/Services/SessionStartupReconciler") {}
