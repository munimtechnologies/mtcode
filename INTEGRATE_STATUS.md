# personal-integrate integration status

Last updated: 2026-08-17

Branch: `personal-integrate`
Final SHA: `54bd3df6d27b4968e98196a3ba97e15dde0046e9`
Remote: **`fork/personal` updated** (fast-forward from `personal-integrate`)

## Completed tier merges

| Branch | Status | Notes |
|--------|--------|-------|
| `tier1-bugfixes` | merged | Already at personal tip |
| `personal-tier2-usage-cursor` | merged | `342a5a1d4` — usage filters, progressive loading, #5920/#5806/#7308 |
| `personal-tier3-preview-polish` | merged | `446db01fa` — preview viewport / device metrics |
| `personal-tier4-features` | merged | `142313189` — preview audio mute + tier4 features; kept both `setViewport` and `setAudioMuted` |
| `tier2-conflicts` | merged | `4612475ee` |
| `tier4-ux` | merged | `5b9e1b46b` — environment rename (#7267) |
| `tier4-voice` / `tier4-voice2` | merged | notifications (#5821), voice dictation (#5213), skill manager (#4630) |
| `tier4-ui` | merged | `947332151` — live tool activity (#7152), reasoning keybindings (#7226) |
| `tier4-big` / `tier4-big2` | merged | goals, plugins, cookie import, PDF (#7309), stacked PRs, queued turns, chat imports |
| `tier4-cookies` | merged | `9c04b177b` — browser cookie import wizard |
| `last3-features` | merged | `8ba80e6a4` |
| `pr-7240` | present | server-side queued turns (via ancestry) |
| `pr-6516` | present | stacked pull request workflows (via ancestry) |
| `pr-7160` | present | multi-provider chat imports |
| `pr-7150` | present | composer state drawers (via ancestry) |

## Required PR numbers (all present)

5920, 5806, 7308, 7309, 5213, 5821, 4630, 7226, 7267, 7152, 7150, 7240, 6516, 7160

## Key conflict resolutions

### Tier 2 usage (`usage.ts`, `UsagePage.tsx`)
- Took tier2 `usageEnvironmentScope` implementation; resolved duplicate import in `UsagePage.tsx`.

### Tier 3 + Tier 4 preview (desktop)
- Kept **both** `setViewport` (tier3) and `setAudioMuted` (tier4) across ipc/preload/contracts/Manager.

### Tier 4-big2 (goals + queued turns + beta settings)
- Migration **041** = `ProjectionThreadsGoal`, **042** = `ProjectionThreadTurnQueue`.
- `ProjectionSnapshotQuery` thread rows: `goal` + `hasQueuedTurns`.
- `ProviderRequestKind` includes `tool` + `permissions`.
- `ChatView` / mobile composer: goals **and** queued-turn delivery modes.
- Voice dictation linked to `/settings/beta`; orphaned route cleaned in `ec545fb58`.

## Push status

```
git push fork personal-integrate          → 54bd3df6d
git push fork personal-integrate:personal → 54bd3df6d (updated)
```

## Remaining / optional

- `personal-tier4-features` tip has one duplicate #5213 merge commit not on `personal-integrate` (content already present).
- Fork tier branches (`tier1`–`tier4-*`) are all **0 commits ahead** of `personal-integrate`.
- Re-fetch `fork` periodically for new tier branches; none pending at last check.
