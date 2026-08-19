#!/usr/bin/env bash
# Deploy the Munim-owned T3 Connect relay through the repo's Alchemy stack
# (infra/relay/). Configuration and secrets come from ~/.mt/munim-relay.env
# (template: scripts/personal-munim-relay.env.example) — the Alchemy
# equivalent of `wrangler secret put`; nothing secret is checked in.
#
# A plain `wrangler deploy` cannot reproduce this Worker: the stack also
# provisions Cloudflare Queues, Hyperdrive over a PlanetScale Postgres
# cluster, Axiom datasets/tokens, per-environment cloudflared tunnels, DNS
# records, a cron trigger, and the Worker's custom domain, and the Worker will
# not boot without those bindings. Hence this wrapper around
# infra/relay/scripts/deploy.ts.
#
# On success, Alchemy writes the deployed relay URL into this repo's root
# .env; copy it into ~/.mt/munim-connect.env as T3CODE_RELAY_URL so client
# builds pick it up.
#
# Refuses unless FORCE_PAID_RELAY=1 — this stack is optional and billed.
set -euo pipefail

if [[ "${FORCE_PAID_RELAY:-}" != "1" ]]; then
  echo "Refusing to deploy the Munim relay stack." >&2
  echo "That deploy bills PlanetScale + Cloudflare Workers Paid (Queues) + Axiom." >&2
  echo "MT Code already works like T3 Code without it:" >&2
  echo "  • desktop app + local server (your machine)" >&2
  echo "  • https://mtcode.munimtech.com (static Worker, free plan)" >&2
  echo "  • pairing / Computer Use to reach that machine" >&2
  echo "  • T3 Connect on the desktop app (T3 pays for relay.t3.codes)" >&2
  echo "Set FORCE_PAID_RELAY=1 only if you accept those bills." >&2
  exit 1
fi

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${MUNIM_RELAY_ENV_FILE:-$HOME/.mt/munim-relay.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — copy scripts/personal-munim-relay.env.example there and fill it in" >&2
  exit 1
fi

# Everything the stack reads (src/worker.ts, src/zone.ts, src/db.ts) plus the
# provider credentials Alchemy needs. AXIOM_API_KEY or AXIOM_TOKEN both work.
required=(
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  PLANETSCALE_API_TOKEN_ID
  PLANETSCALE_API_TOKEN
  PLANETSCALE_ORGANIZATION
  RELAY_API_ZONE_NAME
  RELAY_TUNNEL_ZONE_NAME
  CLERK_PUBLISHABLE_KEY
  CLERK_SECRET_KEY
  CLERK_JWT_AUDIENCE
  APNS_ENVIRONMENT
  APNS_TEAM_ID
  APNS_KEY_ID
  APNS_BUNDLE_ID
  APNS_PRIVATE_KEY
)
missing=()
for name in "${required[@]}"; do
  grep -Eq "^${name}=[^[:space:]]" "$ENV_FILE" || missing+=("$name")
done
if ! grep -Eq "^(AXIOM_API_KEY|AXIOM_TOKEN)=[^[:space:]]" "$ENV_FILE"; then
  missing+=("AXIOM_API_KEY")
fi
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "$ENV_FILE is missing or has placeholder values for: ${missing[*]}" >&2
  exit 1
fi
if grep -Eq "^[A-Z_]+=\.\.\." "$ENV_FILE"; then
  echo "$ENV_FILE still contains '...' placeholder values — fill them in first" >&2
  exit 1
fi
if grep -q "pk_live_Y2xlcmsudDMuY29kZXMk" "$ENV_FILE"; then
  echo "$ENV_FILE contains T3's production Clerk publishable key — refusing" >&2
  exit 1
fi

cd "$REPO/infra/relay"
# deploy.ts loads the env file itself (--env-file) and defaults the stage from
# its `stage` entry (falling back to dev_$USER, which we do not want — non-prod
# stages reference prod-owned resources).
STAGE="${MUNIM_RELAY_STAGE:-$(grep -E '^stage=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)}"
STAGE="${STAGE:-prod}"
exec node -- scripts/deploy.ts --env-file "$ENV_FILE" --stage "$STAGE" "$@"
