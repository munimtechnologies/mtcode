#!/usr/bin/env bash
# Build and submit MT Code iOS (Munim mobile distro) via EAS.
#
# Prerequisites:
#   - eas CLI installed and logged into the Munim Expo account
#   - ~/.mt/munim-connect.env with Munim Clerk keys (recommended)
#   - ASC_APP_ID set after creating the App Store Connect listing
#
# First-time setup (once Munim Expo project exists):
#   cd apps/mobile
#   T3CODE_MOBILE_DISTRO=munim eas init
#   # then set extra.eas.projectId in app.config.ts from the new project id
#
# Usage:
#   bash scripts/personal-publish-ios.sh build    # eas build only
#   bash scripts/personal-publish-ios.sh submit   # eas submit only (needs ASC_APP_ID)
#   bash scripts/personal-publish-ios.sh          # build, then submit when ASC_APP_ID is set
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
MOBILE="$REPO/apps/mobile"

cd "$MOBILE"

# Munim-owned T3 Connect config (public identifiers only), if present.
# shellcheck source=lib/personal-munim-connect-env.sh
source "$REPO/scripts/lib/personal-munim-connect-env.sh"
munim_connect_load

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
  if [[ -z "${ASC_APP_ID:-}" ]]; then
    echo "ASC_APP_ID is required for App Store submit (create the MT Code app in ASC first)" >&2
    exit 1
  fi
  eas submit --platform ios --profile production-munim --asc-app-id "$ASC_APP_ID" --non-interactive --latest
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
    if [[ -n "${ASC_APP_ID:-}" ]]; then
      run_submit
    else
      echo "Skipping submit: set ASC_APP_ID after creating the App Store Connect app."
      echo "  ASC_APP_ID=... eas submit --platform ios --profile production-munim --asc-app-id \"\$ASC_APP_ID\" --latest"
    fi
    ;;
  *)
    echo "usage: $0 [build|submit|all]" >&2
    exit 1
    ;;
esac
