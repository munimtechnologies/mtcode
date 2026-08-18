/**
 * TurnWatchdogReactor - Service interface for the turn stall sweeper.
 *
 * Periodically sweeps the TurnWatchdogService registry, surfaces stalled
 * turns as thread activities, and (when enabled) recovers hung turns by
 * requesting an interrupt.
 *
 * @module TurnWatchdogReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface TurnWatchdogReactorShape {
  /**
   * Start the background sweeper within the provided scope.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Run one sweep immediately. Intended for tests, so assertions never rely
   * on timing.
   */
  readonly sweepNow: Effect.Effect<void>;
}

export class TurnWatchdogReactor extends Context.Service<
  TurnWatchdogReactor,
  TurnWatchdogReactorShape
>()("t3/orchestration/Services/TurnWatchdogReactor") {}
