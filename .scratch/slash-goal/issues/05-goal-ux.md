# 05 — Goal UX

**What to build:** The Goal should feel like a product surface, not a slash trick. Every status has a chip with the right controls. The inbox shows Active Goals. The composer menu and command palette expose the lifecycle. Pause, Blocked, and Usage-limited look different. Activities read as facts, not as fake user messages.

**Blocked by:** 03 — Complete and Blocked; 04 — Usage-limited

**Status:** done

- [x] Thread-header chip shows Objective plus status for Active, Paused, Blocked, Usage-limited, and Complete
- [x] Chip actions: Pause (when Active), Resume (when Paused / Blocked / Usage-limited), Complete (when not already Complete), Clear (when a Goal exists)
- [x] Stop vs Pause is understandable: Stop interrupts this Turn and Pauses; Pause only prevents the next Continuation
- [x] Inbox/shell row shows that a Thread has an Active Goal without opening the Thread
- [x] Composer `/` menu lists `/goal`, `/goal pause`, `/goal resume`, `/goal clear` as built-ins, grouped separately from provider commands
- [x] Command palette can show status, Pause, Resume, Complete, and Clear
- [x] Continuation Activity copy does not look like a user message and does not say the provider started a native Goal
- [x] Web, desktop, and mobile all have the chip and intercept; mobile may be denser but must not omit Pause/Resume/Clear
- [x] No new continuously repainting animation on the chip
