# Continuations have no user message

A Turn in T3 normally starts from a user message. A Continuation has no user. Inserting a synthetic “Continue” row would make every client, including remote ones, show a speaker who did not speak, and those rows cannot be unsent.

We decided a Continuation shows no user message. The assistant output is what the user sees.

The composer's one-tap Continue after Stop (upstream #11716, taken 2026-09-16) follows this rule. Orchestration-v2 starts every run from a message, so Continue sends the T3-authored prompt under a message id derived from the stopped run, and the shared timeline visibility rule (`packages/shared/src/orchestrationV2Timeline.ts`) hides that message on every client. Upstream's Resume after a usage limit still sends a visible "Continue where you left off."

(The fork's Goals feature, which this rule was first written for, was retired on 2026-10-02.)
