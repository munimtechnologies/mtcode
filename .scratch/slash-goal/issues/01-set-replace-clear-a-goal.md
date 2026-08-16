# 01 — Set, replace, and clear a Goal

**What to build:** The user can type `/goal Reduce p95 below 120ms` on web, desktop, or mobile and T3 treats that as a Goal, not as prompt text. On an idle Thread the Objective appears as a normal user message and a Turn starts. On a running Turn the Goal attaches or replaces and the current Turn is left alone. `/goal` with no args shows status. `/goal clear` removes the Goal. A simple chip shows the Objective while it is Active. Command forms never reach a provider.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `/goal <objective>` is a built-in intercept on every composer (web, desktop, mobile), not a provider slash command and not a user message that contains `/goal`
- [x] Idle Thread: Goal is Active, Objective is the user message (no `/goal` prefix), a Turn starts, interaction mode becomes default if it was plan
- [x] Running Turn: Goal is set or replaced; no second Turn starts
- [x] A second `/goal <objective>` replaces the current Goal; a Thread never has two Goals
- [x] `/goal` with no args shows the current Objective and status, or how to set one if absent; it does not start a Turn
- [x] `/goal clear` removes the Goal; the Thread is one-Turn-at-a-time again
- [x] A simple chip shows Objective while a Goal exists (Active is enough; Pause/Blocked/Usage-limited chrome is later)
- [x] Built-in `/goal` wins if a provider also advertises a command named `goal`
- [x] Server refuses `thread.turn.start` whose user text is a command form (`/goal…`, leading `slash goal`); it does not parse that text into a Goal
- [x] An Objective that contains the English word “goal” is allowed
- [x] Thread and shell carry optional Goal fields so older clients still decode
- [x] Orchestration tests cover set / replace / clear / idle-start / running-attach / refuse command forms / allow English “goal”; shared composer parser tests cover `/goal` classification
