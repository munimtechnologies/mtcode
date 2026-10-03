/**
 * T3-authored prompt for the composer's one-tap Continue after Stop. The
 * message that carries it is hidden from every timeline (docs/adr/0005).
 */

const INTERRUPTED_TURN_CONTINUATION_PROMPT = [
  "The previous turn was interrupted before it finished.",
  "Continue from where you left off. Do not repeat work that is already done;",
  "pick up the remaining steps and finish them.",
].join("\n");

export function buildInterruptedTurnContinuationPrompt(): string {
  return INTERRUPTED_TURN_CONTINUATION_PROMPT;
}
