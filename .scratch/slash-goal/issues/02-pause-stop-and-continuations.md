# 02 — Pause, Stop, and Continuations

**What to build:** After a Goal Turn settles, T3 starts the next Turn by itself until the user Pauses. There is no fake user bubble. Stop Pauses. Resume on idle starts a Continuation. Settle, Snooze, and a closed client do not Pause. The Session stays alive while the Goal is Active.

**Blocked by:** 01 — Set, replace, and clear a Goal

**Status:** done

- [x] When a Goal is Active and the Session becomes ready (no running Turn, no pending approval, no pending user-input), T3 starts a Continuation with no user message
- [x] An Activity records that the Goal continued; the assistant output is the visible work
- [x] T3-authored Continuation text names the Objective and the complete/blocked markers, and never contains `goal`, `/goal`, or `slash goal`
- [x] Stop interrupts the Turn and Pauses the Goal; the next Continuation does not start until Resume
- [x] `/goal pause` Pauses without interrupting a running Turn; it only prevents the next Continuation
- [x] `/goal resume` on an idle Thread makes the Goal Active and starts a Continuation immediately
- [x] Resume while a Turn is running only marks Active; it does not double-start
- [x] Settle, Snooze, and disconnect do not Pause an Active Goal
- [x] Continuations are idempotent per completed Turn (a duplicate ready event does not start two)
- [x] The session reaper does not treat an Active Goal as idle
- [x] After process death, T3 still has the Goal and a later Continuation can start a fresh Session
- [x] Codex `thread/goal/*` is not called
- [x] Orchestration tests cover continue-on-ready, no-continue-when-paused, Stop-pauses, pause-without-interrupt, resume-starts-continuation, settle/snooze do not pause, idempotent continue, continue prompt must not say “goal”
