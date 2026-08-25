# mt-teams

The MT Teams Convex backend: Better Auth (email+password, organization plugin —
organizations are teams) plus the HTTP API v1 from
`docs/internals/mt-teams.md`. Follows the Motes Better Auth + Convex pattern
with a local install of the `@convex-dev/better-auth` component so the schema
carries the organization plugin's tables.

## Deployment

- Project: `sheehan-munim/mtcode-teams` (dev deployment `reminiscent-ibis-360`)
- HTTP actions base URL: **https://reminiscent-ibis-360.convex.site**
- Convex API URL: https://reminiscent-ibis-360.convex.cloud
- Dashboard: https://dashboard.convex.dev/t/sheehan-munim/mtcode-teams/reminiscent-ibis-360

Deployment env vars: `BETTER_AUTH_SECRET` (required; set via
`npx convex env set BETTER_AUTH_SECRET <random>`).

## Working on it

```sh
npx convex dev --once   # push functions (uses .env.local for the deployment)
./scripts/e2e.sh        # end-to-end curl smoke test against the dev deployment
```

## Layout

- `convex/betterAuth/` — local install of the Better Auth component
  (schema = base tables + organization/member/invitation).
- `convex/auth.ts` — Better Auth instance: email+password, `bearer()` (session
  token in `Authorization: Bearer`), `organization()`, Convex plugin.
- `convex/schema.ts` — app tables: `environments`, `sharedThreads`,
  `teamMessages`, `teamInvites` (short join code per team).
- `convex/data.ts` — internal queries/mutations used by the HTTP actions.
- `convex/http.ts` — the HTTP API v1 endpoints (CORS `*`, OPTIONS handled),
  plus the Better Auth `/api/auth/*` routes.

## Auth schemes

- User session: `Authorization: Bearer <token>` where the token is the `token`
  field returned by `/api/auth/sign-up/email` or `/api/auth/sign-in/email`.
- Environment key: `X-Environment-Key: <key>` minted once by
  `/api/environments/register`; only its SHA-256 hash is stored.
