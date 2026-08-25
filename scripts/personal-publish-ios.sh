#!/usr/bin/env bash
# Build and submit MT Code iOS (Munim mobile distro) via EAS.
#
# Prerequisites:
#   - eas CLI installed and logged into an account that can build @munimtechnologies/mt-code
#   - ~/.mt/munim-connect.env with Munim Clerk keys (recommended)
#   - apps/mobile/eas.json submit.production-munim.ios configured (ascAppId + API key)
#   - apps/mobile/credentials.json + credentials/ for local signing
#
# Usage:
#   bash scripts/personal-publish-ios.sh build    # eas build only
#   bash scripts/personal-publish-ios.sh submit   # eas submit latest build
#   bash scripts/personal-publish-ios.sh          # build, then submit
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
MOBILE="$REPO/apps/mobile"

cd "$MOBILE"

# Munim-owned T3 Connect config (public identifiers only), if present.
# shellcheck source=lib/personal-munim-connect-env.sh
source "$REPO/scripts/lib/personal-munim-connect-env.sh"
munim_connect_load

# Never publish a build whose upstream merge dropped fork features (kept
# modules, lost call sites). Checks live in personal-verify-fork-features.sh.
"$REPO/scripts/personal-verify-fork-features.sh"

export T3CODE_MOBILE_DISTRO=munim

echo "T3CODE_MOBILE_DISTRO=$T3CODE_MOBILE_DISTRO"
echo "bundle: com.munim.mtcode"
echo "team: 6T5J6U2UVT"
if [[ "$MUNIM_CONNECT_ACTIVE" == 1 ]]; then
  echo "munim-connect: active (Clerk publishable key loaded)"
else
  echo "munim-connect: inactive — build will use repo .env Clerk values if any"
fi

ACTION="${1:-all}"

run_build() {
  eas build --platform ios --profile production-munim --non-interactive
}

run_submit() {
  # ASC app id + API key come from apps/mobile/eas.json submit.production-munim.ios
  eas submit --platform ios --profile production-munim --non-interactive --latest
}

case "$ACTION" in
  build)
    run_build
    ;;
  submit)
    run_submit
    ;;
  all)
    run_build
    run_submit
    ;;
  *)
    echo "usage: $0 [build|submit|all]" >&2
    exit 1
    ;;
esac
