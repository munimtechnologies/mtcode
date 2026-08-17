#!/usr/bin/env bash
# Ship the personal desktop build to Mac + Blade + Dell after an agent change.
#
# Use this instead of a Mac-only DMG install. It pushes `personal` to the fork
# remote if needed, then runs personal-refresh-all.sh with a forced rebuild so
# Windows does not wait for the next 3-hour launchd tick.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
PERSONAL_REMOTE="${T3_PERSONAL_REMOTE:-fork}"

cd "$REPO"
git fetch "$PERSONAL_REMOTE" personal

# If this checkout has local personal commits not on the fork yet, push them —
# Blade builds from github.com/sheehanmunim/t3code@personal, not from this tree.
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "personal" ]]; then
  echo "checkout is '$branch'; expected 'personal' before shipping desktop" >&2
  exit 1
fi

local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse "$PERSONAL_REMOTE/personal")
if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "pushing $local_sha to $PERSONAL_REMOTE/personal (was $remote_sha)"
  git push "$PERSONAL_REMOTE" personal
fi

export T3_FORCE_REBUILD=1
/bin/bash "$REPO/scripts/personal-refresh-all.sh"

# After the private fleet is current, also refresh the public Munim GitHub
# release that munimtech.com / downloaders use (appId com.munim.t3code).
if [[ "${T3_SKIP_MUNIM_PUBLISH:-}" != "1" ]]; then
  echo "publishing Munim public release to GitHub"
  /bin/bash "$REPO/scripts/personal-publish-github-release.sh"
fi
