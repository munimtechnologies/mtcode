/**
 * T3-authored Continuation instructions sent into a Turn.
 *
 * The English word "goal", `/goal`, and "slash goal" must never appear in
 * T3-authored provider text (ADR 0013). The user's Objective is interpolated
 * as-is and may contain the word "goal".
 */

const OBJECTIVE_PLACEHOLDER = "{{objective}}";

const CONTINUATION_TEMPLATE = [
  "Continue working toward this Objective until the outcome is true:",
  "",
  "```",
  OBJECTIVE_PLACEHOLDER,
  "```",
  "",
  "When the outcome is true, emit <objective_complete>…</objective_complete> with brief evidence.",
  "When you cannot make progress, emit <objective_blocked>…</objective_blocked> with what is blocking you.",
  "Emit those tags only from evidence, not from hope or politeness.",
].join("\n");

export function buildGoalContinuationPrompt(objective: string): string {
  return CONTINUATION_TEMPLATE.replace(OBJECTIVE_PLACEHOLDER, objective);
}

export function goalContinuationCommandId(input: {
  readonly threadId: string;
  readonly goalUpdatedAt: string;
  readonly completedTurnId: string;
}): string {
  return `goal-continue:${input.threadId}:${input.goalUpdatedAt}:${input.completedTurnId}`;
}
