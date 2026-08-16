# 04 — Usage-limited

**What to build:** If the provider account is out of quota or rate-limited, the Goal stops as Usage-limited instead of retrying. That is not Blocked and not a user-set token budget. Resume tries again.

**Blocked by:** 02 — Pause, Stop, and Continuations

**Status:** done

- [x] A Turn that ends in error because of account quota or rate-limit sets the Goal to Usage-limited
- [x] Usage-limited stops Continuations
- [x] Ordinary Turn errors do not by themselves Pause, Block, or Usage-limit (the empty-Continuation rule from 03 may still apply later)
- [x] Resume from Usage-limited makes the Goal Active and on idle starts a Continuation
- [x] There is no user-set token cap and no budget-limited status
- [x] Orchestration tests cover quota/rate-limit → Usage-limited and no Continuation, ordinary error ≠ Usage-limited, resume from Usage-limited continues
