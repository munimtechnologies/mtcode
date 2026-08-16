Status: ready-for-agent

Title: T3-native /goal: thread-scoped auto-continue

## Problem Statement

T3 Code stops after one Turn. For work that needs many Turns — a migration, a flaky test hunt, a benchmark loop — the user has to sit there and type “keep going.” Codex already has `/goal` for this, but it lives inside that CLI. T3 talks to five providers. Forwarding `/goal` as prompt text would start a Codex-native Goal that T3 cannot see, pause, or resume, and it would do nothing for Claude, Cursor, Grok, or OpenCode.

The user wants a working `/goal` in T3: a durable Objective on the Thread that keeps working until the outcome is true, or until they Pause, or until the work is Blocked or Usage-limited.

## Solution

A Goal is T3’s completion contract on a Thread. The user sets it with `/goal <objective>`. T3 intercepts that command on every composer and never sends command forms to a provider. If the Thread is idle, T3 records the Objective as a normal user message (without the `/goal` prefix) and starts a Turn. When that Turn settles, T3 starts Continuations by itself — no fake user bubbles — until the Goal is Complete, Paused, Blocked, or Usage-limited.

Stop Pauses the Goal. Settle, Snooze, and a closed client do not. The model may Complete or Block only via a structured signal, not prose. The user can Pause, Resume, Complete, or Clear from the slash command, the chip, and the command palette. One T3 loop serves every provider. Codex’s native Goal API is not used.

## User Stories

1. As a user, I want to type `/goal Reduce p95 below 120ms` on an idle Thread, so that T3 starts working toward that Objective without me sending a second message.
2. As a user, I want that first Turn to show `Reduce p95 below 120ms` as my user message, so that the timeline records what I asked.
3. As a user, I do not want the string `/goal` to appear in the provider prompt, so that Codex cannot start its own Goal beside T3’s.
4. As a user, I want T3 to start the next Turn when the current one finishes and the Goal is still Active, so that I do not have to type “keep going.”
5. As a user, I want Continuations to have no user bubble, so that the timeline is not filled with fake “Continue the Goal” messages.
6. As a user, I want an Activity when a Continuation starts, so that I (and my other devices) can see why a Turn began.
7. As a user, I want to hit Stop and have the Goal Pause, so that work actually stops.
8. As a user, I want `/goal resume` (or a Resume control) to make a Paused Goal Active again, so that work restarts when I am ready.
9. As a user, I want Resume on an idle Thread to start a Continuation immediately, so that I do not have to re-send the Objective.
10. As a user, I want `/goal pause` to Pause without interrupting a running Turn’s process if I only want to prevent the _next_ Continuation — and I want Stop to both interrupt and Pause.
11. As a user, I want `/goal clear` to remove the Goal, so that the Thread goes back to one-Turn-at-a-time behavior.
12. As a user, I want `/goal` with no arguments to show the current Objective and status, so that I can check without changing anything.
13. As a user, I want `/goal` with no Goal on the Thread to explain how to set one, so that an empty command is not a silent no-op.
14. As a user, I want `/goal Ship the migration instead` to replace the current Goal, so that changing my mind is one command.
15. As a user, I want replace-while-running to leave the current Turn alone and apply the new Objective to later Continuations, so that T3 does not steal an in-flight Turn.
16. As a user, I want Stop during a replace-while-running Turn to Pause the _new_ Goal, so that Stop always Pauses whatever is current.
17. As a user, I want at most one Goal per Thread, so that I am not managing a backlog.
18. As a user in plan mode, I want `/goal Implement this plan` to switch the Thread to default (build) mode, so that Continuations actually execute.
19. As a user, I want a Goal to keep working after I Settle the Thread, so that independent hours of work do not die when I shelf it.
20. As a user, I want a Goal to keep working after I Snooze the Thread, so that hiding it from the inbox is not Pause.
21. As a user, I want a Goal to keep working after I close the laptop or the mobile app, so that the server owns the loop.
22. As a user on mobile, I want `/goal` intercepted the same way as on web, so that my phone cannot leak `/goal` into Codex.
23. As a user on desktop, I want the same `/goal` as web, so that the Electron shell does not have a second path.
24. As a user, I want a chip in the Thread header showing Objective and status, so that I can see the contract without opening a menu.
25. As a user, I want Pause, Resume, Complete, and Clear on that chip, so that I do not have to remember slash syntax.
26. As a user, I want the inbox/shell row to show that a Thread has an Active Goal, so that I can find running independent work.
27. As a user, I want command palette actions for set/pause/resume/clear/status, so that `/goal` is not composer-only.
28. As a user, I want the composer `/` menu to list `/goal` as a built-in, so that I can discover it next to `/model`.
29. As a user, I want `/goal pause`, `/goal resume`, and `/goal clear` in that menu, so that lifecycle is as discoverable as set.
30. As a Claude user, I want `/goal` to work even though Claude has its own slash commands, so that T3’s intercept wins over any provider `goal` command.
31. As a Codex user, I want `/goal` to work without Codex’s native Goal runtime, so that Pause and Complete are T3’s.
32. As a Cursor, Grok, or OpenCode user, I want the same `/goal`, so that the feature is not Codex-only.
33. As a user, I want the agent to Complete the Goal only when it emits a structured complete signal, so that “I think we’re done” in chat does not stop the loop.
34. As a user, I want to mark a Goal Complete myself, so that I can accept the outcome without waiting for the model.
35. As a user, I want the agent to enter Blocked via a structured signal when it cannot make progress, so that I am not babysitting a stuck loop.
36. As a user, I want T3 to enter Blocked after several Continuations with no tools and no checkpoint diff, so that empty Turns cannot burn tokens forever.
37. As a user, I want Blocked to look different from Pause, so that I know the work stopped itself.
38. As a user, I want Resume from Blocked to try again, so that I can unblock after fixing permissions or tests.
39. As a user, I want quota / rate-limit failures to enter Usage-limited, so that 429s do not retry until I notice.
40. As a user, I want Usage-limited to look different from Blocked, so that I know the account is exhausted, not the work.
41. As a user, I want Resume from Usage-limited to try again, so that I can continue after the window resets.
42. As a user, I do not need a token cap on the Goal in v1, so that we can ship the loop without usage accounting UI.
43. As a user, I want pending approvals to delay Continuation, so that T3 does not start a Turn on top of a permission prompt.
44. As a user, I want pending user-input to delay Continuation, so that T3 waits for my answer.
45. As a user, I want a Continuation to wait until the Session is ready, so that T3 never double-starts a Turn.
46. As a remote user, I want Continuations to appear on every subscribed client, so that my phone sees work my desktop started.
47. As a user, I want an old or buggy client that still sends `/goal …` as Turn text to be refused by the server, so that command forms never reach a provider.
48. As a user, I want “slash goal …” in a pasted message refused the same way, so that spoken command forms cannot leak.
49. As a user, I want an Objective that contains the English word “goal” to be allowed, so that “the goal of this function is …” still works.
50. As a user, I want T3’s hidden Continuation instructions to avoid the word “goal,” so that the CLI cannot treat our prompt as native `/goal`.
51. As a user, I want Stop during a Continuation to Pause, so that Stop is consistent whether or not I sent the last message.
52. As a user, I want Clear during a running Turn to cancel auto-continue after that Turn (and not leave an Active Goal), so that Clear is a real way out.
53. As a user, I want deleting a Thread to drop its Goal, so that deleted work cannot Continue.
54. As a user, I want the session reaper to leave an Active Goal’s Session alive, so that a 30-minute pause between Continuations cannot kill independent work.
55. As a user, I want a Goal to survive provider process death, so that the next Continuation can spawn a fresh Session from T3’s stored Objective.
56. As a user, I want Complete to stop Continuations immediately, so that a successful structured signal is the end.
57. As a user, I want to `/goal` a new Objective after Complete, so that the Thread can take another contract.
58. As a maintainer, I want provider Goal APIs unused, so that there is one loop to debug.
59. As a maintainer, I want Goal state on the Thread, not the Session, so that a reap cannot forget the contract.
60. As a user connecting via tunnel or Tailscale, I want the same Goal behavior, so that remote access is not a second product.

## Implementation Decisions

- A Goal hangs on the Thread read model, optional, same overlay pattern as Snooze. It is not Session state and not jammed into thread meta.
- Goal shape: Objective, status (`active` | `paused` | `blocked` | `usageLimited` | `complete`), created and updated timestamps. v1 has no token budget field.
- Thread shell carries a compact Goal summary (status plus truncated Objective) so the inbox can render without loading Thread detail. Older clients must still decode shells that omit it.
- Client-dispatchable commands: `thread.goal.set` (Objective required; replaces any existing Goal), `thread.goal.pause`, `thread.goal.resume`, `thread.goal.clear`, `thread.goal.complete` (user Complete). Same command family style as Snooze / pin.
- Events: `thread.goal-set`, `thread.goal-paused`, `thread.goal-resumed`, `thread.goal-cleared`, `thread.goal-completed`, `thread.goal-blocked`, `thread.goal-usage-limited`. Projector applies these onto `thread.goal`.
- Internal-only command `thread.goal.continue` (reactor, not a client RPC) emits `thread.turn-start-requested` **without** `thread.message-sent`. Provider command handling treats that like a Turn start: ensure Session, `sendTurn` with adapter-private Continuation text.
- Continuation command ids are stable per `(goal generation, completed turn id)` so a duplicate Session-ready event cannot double-Continue.
- `thread.goal.set` on an idle Thread (no running Turn, Session not `running`) also starts a user Turn: `thread.message-sent` with the Objective as user text, then `thread.turn-start-requested`. The `/goal` prefix is never in that text.
- `thread.goal.set` while a Turn is running only replaces the Goal. Continuations after that Turn use the new Objective.
- Becoming Active (`set` or `resume`) emits the existing `thread.interaction-mode.set` to `default` when the Thread is in plan mode.
- `thread.turn.interrupt` while a Goal is Active also emits `thread.goal-paused`. Interrupt without an Active Goal is unchanged.
- `thread.goal.pause` while a Turn is running does not interrupt that Turn; it only prevents the next Continuation. Stop is the interrupt+Pause path. Document this in the chip: Pause vs Stop.
- Clear while a Turn is running: Goal is removed immediately so the settling Turn does not Continue. The in-flight Turn is not auto-interrupted (user can Stop). If product later wants Clear to Stop too, that is a follow-up.
- A GoalReactor runs after Session leaves `running` for `ready` (or equivalent idle). If Goal is Active, in budget (always in v1), no pending approval, no pending user-input, Session not running: dispatch `thread.goal.continue`. If status is Paused / Blocked / Usage-limited / Complete / absent: do nothing.
- Do not Continue in plan mode. If that invariant is ever violated, refuse rather than Continue.
- Settle, Snooze, pin, archive visibility, and client disconnect do not change Goal status.
- Session reaper treats Active Goal like live work and must not reap that Session for inactivity.
- Structured signals are XML tags in assistant output, same ingestion idea as proposed plans, **without the word “goal”** in the tag or in T3-authored Continuation text:
  - `<objective_complete>` … `</objective_complete>` → `thread.goal.complete` equivalent (Blocked/Complete from the model go through internal commands, not client RPCs).
  - `<objective_blocked>` … `</objective_blocked>` → Blocked.
- Prose “done” / “I’m stuck” does not change Goal status.
- After three consecutive Continuations with no tool item and no non-empty checkpoint diff, T3 emits Blocked. Resume resets that counter. The first user Turn of a Goal does not count toward the empty-Continuation streak.
- Usage-limited: when a Turn ends in error and the provider runtime indicated account rate-limit / quota exhaustion, emit `thread.goal-usage-limited` instead of Continuing. Ordinary Turn errors do not Pause or Block by themselves (empty-Continuation rule may still fire later).
- Command-form detector (shared, used by composers and server invariants). A Turn’s user text is a command form if, after trim, it matches any of:
  - a leading `/goal` token (any case), with or without arguments
  - the phrase `slash goal` as a command (`slash goal` at the start, any case)
  - `/goal` as the first path-like token in the message
    The English word `goal` elsewhere is not a command form.
- Every composer (web, desktop-via-web, mobile) intercepts command forms on select and on send. Standalone `/goal` / `/goal pause` / `/goal resume` / `/goal clear` do not call `thread.turn.start`. `/goal <objective>` calls `thread.goal.set` and, if idle, `thread.turn.start` with the Objective only.
- Server `thread.turn.start` invariants refuse command-form user text. Refusal does not set a Goal. Setting a Goal is only `thread.goal.set`.
- Continuation `sendTurn` input is a T3-authored instruction that names the Objective, asks for evidence-based `<objective_complete>` or `<objective_blocked>`, and never contains `goal`, `/goal`, or “slash goal.”
- Adapters gain no Goal API. They already accept `sendTurn` with optional text. Continuations use that. Codex `thread/goal/*` is not called. Goal notifications from Codex, if any, remain ignored.
- Activities: Goal set, Continuation started, Paused, Resumed, Completed, Blocked, Usage-limited, Cleared. Tone follows existing Activity tones (info vs warning vs danger as appropriate).
- Slash menu: built-in `/goal` always listed (not behind the plan-mode beta flag). Provider slash lists must not win over the built-in for the name `goal`.
- Command palette exposes Goal status plus Pause / Resume / Clear / Complete.
- User docs and glossary: add Goal, Objective, Continuation, Pause, Complete, Clear, Blocked, Usage-limited in maintainer glossary language; user-facing docs in shipped-product voice with no source paths.
- Pairing scope for `thread.goal.*` is the same as `thread.turn.start`.
- Optional decode: Goal fields on Thread and shell are optional so older clients ignore them.

## Testing Decisions

Good tests assert external behavior: commands produce events and a projected Goal; a Session becoming ready either requests a Continuation or does not; command-form text is refused; structured tags change status and prose does not; Stop Pauses; Settle does not. Tests do not assert reactor internals, adapter method names, or CSS.

Primary seam: orchestration. Prior art is Snooze decider tests (command → events), command invariant tests (refuse illegal turns), proposed-plan ingestion tests (runtime text → domain fact), and provider command reactor tests (intent event → `sendTurn`). Goal tests live in those same kinds of suites:

- Set / replace / pause / resume / clear / user-complete on the decider.
- Set on idle also requests a user Turn whose message is the Objective.
- Set while running does not request a second Turn.
- Interrupt while Active also Pauses.
- Settle / Snooze commands do not change Goal status.
- Becoming Active sets interaction mode to default.
- `thread.turn.start` with command-form text is rejected; `the goal of this function is X` is accepted.
- Ingestion: `<objective_complete>` Completes; `<objective_blocked>` Blocks; “we’re done” in assistant text does not.
- After Session goes ready: Active Goal with no blockers requests a Continuation with no user message; Paused / Blocked / Usage-limited / Complete / missing Goal does not.
- Three empty Continuations → Blocked.
- Quota-exhaustion Turn error → Usage-limited, not a Continuation.
- Continuation `sendTurn` text contains the Objective and the complete/blocked tags, and does not contain `goal` / `/goal` / `slash goal`.
- Idempotent Continuation: two ready events for the same completed Turn request one Continuation.
- Reaper: Active Goal is not treated as idle.

Reuse existing composer parser tests (the `/plan` standalone parser and slash-command detection). Extend them for `/goal`, `/goal pause|resume|clear`, arguments vs status, and `slash goal`. Web and mobile should share that helper so one test file covers classification; platform tests only need to prove they call it on send (if a thin existing composer test can say that; do not add a browser seam).

Do not add Codex app-server Goal RPC tests. Do not add Playwright or mobile UI automation for v1 of this spec.

## Out of Scope

- User-set token budgets and a budget-limited status.
- Calling Codex `thread/goal/set|get|clear` or handling those notifications as source of truth.
- `/loop` (interval or event-scheduled re-prompt).
- Synthetic user messages for Continuations.
- Multiple Goals per Thread / a Goal queue.
- Auto-continue in plan mode.
- Redacting the English word “goal” from user Objectives.
- Server-side parsing of `/goal …` into `thread.goal.set` (refuse only).
- Pause-on-Settle or Pause-on-Snooze.
- A first-class timeline row type other than Activity + assistant output + the originating user message.
- Changing provider slash-command probing (Claude’s list stays; T3 `/goal` just wins on name collision).
- New adapter methods.
- Keybinding beyond what `/plan` already has, unless a palette entry is missing; Shift+Tab remains plan-mode’s shortcut, not Goal’s.

## Further Notes

Vocabulary and one-way decisions for this spec live in `CONTEXT.md` and ADRs 0001–0014 on branch `investigate/slash-goal`. Use those terms in code and tests: Goal, Objective, Active, Pause, Resume, Complete, Clear, Blocked, Usage-limited, Continuation, Thread. Do not say loop, sticky reminder, native goal, or Codex goal for T3’s contract.

Still tunable after v1, not blockers: the empty-Continuation count (specified as three), chip copy, and whether Clear should also Stop a running Turn.

N = 3 and `/goal` with no args as status are specified here so implementation does not re-litigate them.
