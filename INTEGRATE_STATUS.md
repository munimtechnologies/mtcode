# personal-integrate integration status

Last updated: 2026-08-17

Branch: `personal-integrate` (ahead of `fork/personal-integrate` — push after local commits)
Remote: `fork/personal-integrate` — **`fork/personal` not updated** (by design)

## Completed tier merges

| Branch / PR | Status | Notes |
|-------------|--------|-------|
| `personal-tier2-usage-cursor` | merged | `342a5a1d4` — tier2 multi-env usage UX + filters; `usageStatus.ts` retained |
| `personal-tier3-preview-polish` | merged | `446db01fa` — preview viewport / device metrics |
| `personal-tier4-features` | content present | Tip not ancestor (duplicate #5213 merge); features landed via other tiers |
| `tier2-conflicts` | merged | `4612475ee` |
| `tier4-ux` | merged | notifications, voice dictation (#5213), etc. |
| `tier4-voice` / `tier4-voice2` | merged | skill manager (#4630) |
| `tier4-ui` | merged | live tool activity (#7152) |
| `tier4-big` | merged | goals, plugins, cookie import, ctrl+tab, PDF attachments |
| `tier4-big2` | merged | `0a919420a` — Hermes, chat import, stacked PRs (#6516), queued turns (#7240), composer drawers (#7150), chat imports (#7160) |
| `tier4-cookies` | merged | environment rename (#7267) |
| `last3-features` | merged | `8ba80e6a4` |
| `pr-7240` | merged | server-side queued turns |
| `pr-6516` | merged | stacked pull request workflows |
| `pr-7160` | merged | multi-provider chat imports |

## Key conflict resolutions

### Tier 2 usage
- Kept tier2 multi-environment filters, unavailable handling, progressive loading (`usageEnvironmentScope`).
- Kept tier1 `usageStatus.ts` on disk (optional wiring to `usage.ts` remains a follow-up).

### Tier 3 + Tier 4 preview (desktop)
- Kept **both** `setViewport` (tier3) and `setAudioMuted` (tier4) across ipc/preload/Manager.

### Tier 4-big2 (goals + queued turns + migrations)
- Migration **041** = `ProjectionThreadsGoal`, **042** = `ProjectionThreadTurnQueue`.
- `ProjectionSnapshotQuery` thread rows include `goal` + `hasQueuedTurns`.
- `ProviderRequestKind` includes `tool` + `permissions`.
- `ChatView` / mobile composer: goals **and** queued-turn delivery modes.
- Voice dictation stays under **General** settings (removed orphaned `/settings/beta` route).

## Fork branches fetched

Present on fork: `tier2-conflicts`, `tier4-ux`, `tier4-cookies`

## Remaining / optional

- `personal-tier4-features` tip still not an ancestor (duplicate merges only).
- `tier4-voice2` / `tier4-ui2` are **behind** `personal-integrate` — do not merge.
- Wire `deriveUsageSettlingState` into web `usage.ts` if refresh-in-flight should not count stale SWR summaries as answered.

## Next steps

1. Push: `git push fork personal-integrate`
2. Run CI / smoke tests on `personal-integrate`.
3. Open PR `personal-integrate` → `personal` on fork when ready.
