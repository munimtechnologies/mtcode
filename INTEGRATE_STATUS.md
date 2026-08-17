# personal-integrate integration status

Last updated: 2026-08-17 (local)

Branch: `personal-integrate` @ `283a57eca`
Remote: `fork/personal-integrate` (pushed)

## Completed tier merges

| Branch | Status | Notes |
|--------|--------|-------|
| `personal-tier2-usage-cursor` | merged | `342a5a1d4` — usage conflicts resolved (tier2 multi-env UX + filters; `usageStatus.ts` kept on disk) |
| `personal-tier3-preview-polish` | merged | `446db01fa` — preview viewport / device metrics |
| `personal-tier4-features` | merged | `09cc37078` / `142313189` — kept **both** `setViewport` (tier3) and `setAudioMuted` (tier4) across ipc/preload/Manager |
| `tier2-conflicts` | merged | `4612475ee` — clean merge (CodexAdapter) |
| `tier4-ux` | merged | voice dictation (#5213), notifications (#5821), etc. via `5b9e1b46b` |
| `tier4-voice` | merged | `283a57eca` — skill manager (#4630) |
| `tier4-ui` | merged | live tool activity grouping (#7152) |
| `tier4-big` | merged | ctrl+tab switcher, PDF attachments, browser cookie import, goals, plugins |
| `tier4-cookies` | merged | `9c04b177b` — environment rename (#7267) |

## Conflict resolutions (summary)

### Tier 2 usage (`UsagePage.tsx`, `usage.ts`)
- Kept tier2 multi-environment filter, unavailable/offline handling, progressive loading, and `usageEnvironmentScope`.
- Kept tier1 `usageStatus.ts` module (refresh/settling helpers) — not removed.
- `UsageDeviceStrip` uses tier2 `isEnvironmentUsageStillReporting` plus tier2 unavailable phase labels.

### Tier 4 preview/ipc (desktop)
- **Policy: keep both features** — no feature dropped.
- `PREVIEW_SET_VIEWPORT_CHANNEL` + `PREVIEW_SET_AUDIO_MUTED_CHANNEL`
- `setViewport` / `automationSetViewport` (tier3 toolbar path, no agent badge)
- `setAudioMuted` (tier4 tab mute, lifecycle-locked)
- `Manager.test.ts`: viewport override test + full audio/mute test suite

## Fork branches checked

```
git fetch fork
```

Present on fork and integrated: `tier2-conflicts`, `tier4-ux`, `tier4-cookies`

Not on fork (local-only, already integrated when present): `tier4-voice`, `tier4-ui`, `tier4-big`

## Remaining / follow-up

- `personal-tier4-features` tip (`5f8325226`) is **not** an ancestor of `personal-integrate` because voice dictation (#5213) landed twice (via `tier4-ux` and again on tier4-features). **Content is already present** (`transcription.ts`, `VoiceTranscriptionPanel.tsx`, etc.).
- `fork/personal` intentionally **not** updated — push `personal-integrate` only until integration is complete.
- Optional hardening: wire `deriveEnvironmentUsageStatus` / `deriveUsageSettlingState` from `usageStatus.ts` into `apps/web/src/state/usage.ts` if refresh-in-flight should not count stale SWR summaries as “answered” (tier1 nuance; tier2 tests currently use `getEnvironmentUsageLoadingState`).

## Next steps

1. Run CI / smoke tests on `personal-integrate`.
2. When satisfied, open PR: `personal-integrate` → `personal` on fork.
3. Re-fetch fork periodically for new `tier4-*` branches.
