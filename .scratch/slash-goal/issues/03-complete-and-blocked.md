# 03 — Complete and Blocked

**What to build:** The loop can end because the work is done or because it is stuck. The model may Complete or Block only with a structured signal. The user may Complete by hand. Three Continuations with no tools and no checkpoint diff enter Blocked. Resume from Blocked tries again.

**Blocked by:** 02 — Pause, Stop, and Continuations

**Status:** done

- [x] Assistant `<objective_complete>…</objective_complete>` Completes the Goal; Continuations stop
- [x] Assistant `<objective_blocked>…</objective_blocked>` enters Blocked; Continuations stop
- [x] Chat prose (“done”, “I’m stuck”) does not change Goal status
- [x] The user can Complete the Goal explicitly; Continuations stop
- [x] After three consecutive Continuations with no tool item and no non-empty checkpoint diff, T3 enters Blocked
- [x] The originating user Turn does not count toward that empty-Continuation streak
- [x] Resume from Blocked makes the Goal Active, resets the empty streak, and on idle starts a Continuation
- [x] Pause and Blocked are different statuses (thin chip may just show the status word until UX)
- [x] Orchestration tests cover structured complete, structured blocked, prose ignored, user complete, three empty Continuations → Blocked, first user Turn not counted, resume from Blocked continues
