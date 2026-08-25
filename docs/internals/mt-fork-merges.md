# Merging upstream t3code into MT Code

This fork (munimtechnologies/mtcode) carries custom features on top of
upstream pingdotgg/t3code. Upstream merges are done only when Sheehan
explicitly asks an agent to do one — never automatically.

## The failure mode to defend against

A merge conflict that fails loudly is the easy case. The recurring, dangerous
case is the **silent call-site drop**: the merge keeps a fork feature's
modules, types, and tests, but resolves the few lines that _call_ them in
upstream's favor. Typecheck stays clean, unit tests stay green, and the
feature is simply gone from the app. This has really happened to: Goals
wiring, the usage "All" window button, the composer `/goal` menu, the `#`
thread-reference chip, the web dictation mic, MT Auto in the model picker,
and the upstream-PR cards UI.

`apps/web/src/components/chat/ChatComposer.tsx` and
`apps/web/src/components/ChatView.tsx` are the highest-risk files — upstream
rewrites them constantly and most fork UI wiring lives there. The in-memory
`apps/server/src/orchestration/projector.ts` silently ignores unknown events
(`default: return …`), so dropped event cases surface only as refused
commands at runtime.

## Required procedure for every upstream merge

1. Before merging, create a backup branch:
   `git branch backup/mtcode-pre-upstream-sync-$(date +%Y%m%d)`
2. Merge. When resolving conflicts in fork-customized files, keep BOTH sides:
   upstream's changes AND the fork's call sites. Never resolve a
   fork-customized hunk wholesale in upstream's favor.
   Keep-both regex resolutions tend to drop shared closing lines (`});`)
   that git hoisted out of the hunk — typecheck after every file.
3. Run `scripts/personal-verify-fork-features.sh`. It greps for each fork
   feature's call site and fails loudly listing what the merge dropped.
   Restore every dropped call site (`git log -S '<pattern>'` finds the
   last-good commit) — do not delete checks.
4. When a merge adds a NEW fork feature, add a `require` line for its most
   drop-prone call site to `scripts/personal-verify-fork-features.sh` in the
   same PR.
5. Only push to fork/main once the script passes. The fleet refresh
   (`personal-refresh-all.sh`) and all publish scripts also run it and will
   refuse to build a commit that fails.
