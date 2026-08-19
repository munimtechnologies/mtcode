#!/usr/bin/env bash
# Build and deploy the hosted MT Code web app (https://mtcode.munimtech.com),
# a static-assets Worker configured by scripts/mtcode-web.wrangler.jsonc.
#
# Run from a checkout WITHOUT a repo-root .env: vite.config merges .env
# underneath the process env, and the main dev checkout's .env carries T3's
# production Clerk/relay keys, which must not be baked into this bundle.
#
# Connect: ~/.mt/munim-connect.env supplies Munim Clerk (MT Connect). T3 Connect
# is always offered as a second option (public T3 identifiers, or an Open T3
# Connect link on this origin — T3's Clerk rejects mtcode.munimtech.com).
# A Munim relay URL is optional and should stay omitted: without it the hosted
# app signs in with MT Connect and reaches computers via pairing / Computer Use
# (same $0 model as T3 Code; no PlanetScale / Workers Paid relay).
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_MUNIM_WEB_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
HOSTED_URL="${T3_MUNIM_HOSTED_URL:-https://mtcode.munimtech.com}"

cd "$REPO"
if [[ -f .env || -f .env.local ]]; then
  echo "refusing to build: $REPO has a repo-root .env(.local); use a clean worktree" >&2
  exit 1
fi

# Munim-owned T3 Connect config (public identifiers only), if present.
# shellcheck source=lib/personal-munim-connect-env.sh
source "$REPO/scripts/lib/personal-munim-connect-env.sh"
munim_connect_load
if [[ "$MUNIM_CONNECT_ACTIVE" != 1 ]]; then
  echo "building without Munim Clerk; T3 Connect will still be offered as an external option"
fi

# Match the desktop munim distro: Nightly stage (sidebar artwork) with a plain
# "MT Code" shell name, no "(Alpha)"/"(Nightly)" suffix.
VITE_HOSTED_APP_URL="$HOSTED_URL" VITE_APP_BASE_NAME="MT Code" \
  VITE_APP_STAGE_LABEL="Nightly" VITE_APP_DISPLAY_NAME="MT Code" \
  vp run --filter @t3tools/web build
node scripts/apply-web-brand-assets.ts munim apps/web/dist

# index.html branding is static markup; the VITE_* overrides only reach the
# runtime bundle.
sed -i '' 's/T3 Code (Alpha)/MT Code/; s/T3 Code splash screen/MT Code splash screen/' apps/web/dist/index.html

# Static-assets Worker with a custom domain (auto-creates DNS; SPA fallback
# comes from not_found_handling in the wrangler config — no _redirects file,
# Workers assets rejects the Pages-style rule).
rm -f apps/web/dist/_redirects
wrangler deploy --config scripts/mtcode-web.wrangler.jsonc
echo "deployed $HOSTED_URL"
