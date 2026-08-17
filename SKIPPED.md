# Tier 2 merge SKIPPED

Branch: personal-tier2-usage-cursor

Note: Git cannot create a branch named `personal/tier2-usage-cursor` while `personal` exists as a sibling branch ref, so this work landed on `personal-tier2-usage-cursor`.

## Skipped PRs

No PRs skipped. All Tier 2 PRs were merged (some required manual conflict resolution).

## Merged PRs

- #5828: fix(usage): handle unavailable environments
- #5920: fix(usage): Improve usage tab for multi environment setups with timeouts and progressive loading
- #5806: fix(usage): usage no longer misses custom provider-instance homes
- #7245: fix(server): treat Cursor API keys as authenticated
- #7232: fix(server): a provider probe timeout no longer marks the provider broken
- #7233: fix(client): a busy backend no longer looks like a disconnect
- #7315: fix(server): settle orphaned provider sessions at startup
- #7195: fix(web): allow new threads when unsettled env is offline
- #7216: fix(server): new threads survive a renamed project folder
- #7308: fix(codex): recover turns after usage limits
- #7238: fix(server): exclude inherited Codex child usage
- #7294: fix(desktop): cap macOS shell startup probe

## Conflict resolution notes

- Usage UI/state PRs (#5828, #5920): preserved personal fork usage providers (Cursor/OpenCode/Grok), account limits UI, pricing status, and environment filtering; integrated upstream unavailable-env handling, progressive loading, and query timeouts.
- #5806: merged multi-instance Claude/Codex home discovery while keeping Grok, OpenCode, and Cursor export scanning.
- #7308: merged Codex usage-limit turn recovery while keeping computer-history context on turn start and collab-agent usage tracking.

---

# Skipped Tier 3 PRs

- (none)
