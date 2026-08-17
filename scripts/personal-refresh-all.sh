#!/usr/bin/env bash
# Keep personal fork apps current on Mac + Blade + Dell.
# Source of truth: sheehanmunim/t3code@personal (git remote "fork" on this Mac).
# Builds with latest upstream nightly version so logo/artwork are Nightly,
# but product name stays "T3 Code".
#
# Flow: push feature commits to fork/personal → this job (launchd every 3h, or
# T3_FORCE_REBUILD=1) rebuilds Mac, builds Windows on Blade, installs on Dell.
set -euo pipefail

# /usr/local/bin carries the corepack shims — pnpm among them. launchd starts this job with a
# bare PATH, so leaving it out meant every scheduled rebuild died at "pnpm: command not found"
# and only hand-run rebuilds ever reached the build step.
export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
# Mac checkout uses "fork" → github.com/sheehanmunim/t3code (not origin/pingdotgg).
PERSONAL_REMOTE="${T3_PERSONAL_REMOTE:-fork}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
STATE="$LOG_DIR/last-built-sha"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/orchestrate-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate start ===="

cd "$REPO"
git fetch "$PERSONAL_REMOTE" personal
# Upstream too, because the fork is meant to stay level with it rather than drift: the fork being
# unchanged is no longer a reason to skip a run, since upstream may have moved instead.
UPSTREAM_REMOTE="${T3_UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${T3_UPSTREAM_BRANCH:-main}"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
NEW=$(git rev-parse "$PERSONAL_REMOTE/personal")
UPSTREAM_HEAD=$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
OLD=$(cat "$STATE" 2>/dev/null || true)
echo "${PERSONAL_REMOTE}/personal=$NEW previously=$OLD"
echo "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}=$UPSTREAM_HEAD"

git checkout personal
git reset --hard "$PERSONAL_REMOTE/personal"

# --- stay level with upstream ---
# The fork carries its own features on top of T3 Code, and every hour it spends behind is another
# hour of drift for those features to conflict with. So each run merges upstream first and the
# build decides whether it was a good idea: a merge that compiles is pushed, one that does not
# never leaves this machine.
#
# Conflicts are not fixed here. A script cannot judge which side of a conflict was deliberate;
# the merge is taken back and the pull requests page's "Take release" button hands the same merge
# to an agent in a worktree, which can.
BEHIND=$(git rev-list --count "HEAD..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
MERGED_UPSTREAM=0
if [[ "$BEHIND" -eq 0 ]]; then
  echo "level with ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
elif git merge --no-edit "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"; then
  MERGED_UPSTREAM=1
  echo "UPSTREAM_MERGED $BEHIND commits from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
else
  git merge --abort || true
  echo "UPSTREAM_MERGE_CONFLICT $BEHIND commits behind ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} — take the release from the pull requests page and let an agent resolve it" >&2
fi

if [[ "$NEW" == "$OLD" && "$MERGED_UPSTREAM" -eq 0 && -z "${T3_FORCE_REBUILD:-}" ]]; then
  echo "no changes — skipping rebuild"
  exit 0
fi

# Bake T3 Connect public client config into desktop artifacts (gitignored .env).
# Without this, hasCloudPublicConfig() is false and Connect UI is omitted.
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example for T3 Connect"
fi

# Match latest upstream nightly version string → Nightly icons + sidebar artwork
NIGHTLY_TAG=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty')
if [[ -z "$NIGHTLY_TAG" ]]; then
  echo "could not resolve latest nightly tag" >&2
  exit 1
fi
export T3CODE_DESKTOP_VERSION="${NIGHTLY_TAG#v}"
echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"

# --- Mac ---
echo "-- building Mac --"
pnpm dist:desktop:dmg:arm64

# The build is the review. An upstream merge only becomes the fork's history once it has compiled
# here — pushed before Blade builds, because Blade builds from the fork rather than from this
# tree, and an unpushed merge would have the three machines running different code.
if [[ "$MERGED_UPSTREAM" -eq 1 ]]; then
  git push "$PERSONAL_REMOTE" personal
  NEW=$(git rev-parse HEAD)
  echo "UPSTREAM_MERGE_PUSHED $NEW"
fi
# Install + relaunch before Windows work so this Mac is never left shut while Blade builds.
/bin/bash "$REPO/scripts/personal-install-relaunch-mac.sh"

T3_FORCE_REBUILD=1 /bin/bash "$REPO/scripts/personal-refresh-windows.sh"

echo "$NEW" > "$STATE"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate done ===="
