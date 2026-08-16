/**
 * GoalReactor - Continuation reaction service interface.
 *
 * Owns a background worker that reacts to Session-ready domain events and
 * requests a Continuation when a Goal is Active.
 *
 * @module GoalReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * GoalReactorShape - Service API for Goal Continuation workers.
 */
export interface GoalReactorShape {
  /**
   * Start reacting to Session-ready orchestration domain events.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * GoalReactor - Service tag for Goal Continuation workers.
 */
export class GoalReactor extends Context.Service<GoalReactor, GoalReactorShape>()(
  "t3/orchestration/Services/GoalReactor",
) {}
