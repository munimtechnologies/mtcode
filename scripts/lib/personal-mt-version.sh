# Single MT Code version. Source this file from a repo-root cwd, then call
# personal_mt_export_desktop_version.
#
# MT Code has one release channel. We still follow upstream T3's current base
# version (0.0.34 from v0.0.34-nightly.…) so rebuilds can move forward, but we
# never stamp the "-nightly.YYYYMMDD.N" prerelease that would put the updater
# on T3's nightly feed.

personal_mt_strip_nightly_prerelease() {
  local version="$1"
  echo "${version%%-nightly*}"
}

# Highest already-published munim-v release, without the prefix. Empty when the
# release repo has none or gh is unavailable.
personal_mt_published_version() {
  local repo="${T3_MUNIM_RELEASE_REPO:-munimtechnologies/mtcode}"
  gh release list -R "$repo" --limit 100 --json tagName \
    --jq '[.[] | select(.tagName | startswith("munim-v")) | .tagName | ltrimstr("munim-v")]
          | map(split(".") | map(tonumber? // 0))
          | sort | reverse | .[0] // empty | join(".")' 2>/dev/null || true
}

# Returns the greater of two dotted versions.
personal_mt_max_version() {
  printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1
}

personal_mt_resolve_version() {
  local root="${REPO:-.}"
  local pkg tag base published candidate
  pkg=$(
    cd "$root" &&
      node -p "require('./apps/desktop/package.json').version.replace(/-nightly\\.[0-9.]+$/, '')"
  )
  tag=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty' 2>/dev/null || true)
  if [[ -n "$tag" ]]; then
    base="${tag#v}"
    candidate=$(personal_mt_strip_nightly_prerelease "$base")
  else
    candidate="$pkg"
  fi

  # Upstream's nightly base can sit BELOW what this fork has already shipped
  # (MT releases have run ahead before), so never resolve behind the newest
  # published release — a fleet build that used the lower number would install
  # something different from what is on GitHub under the same version.
  published=$(personal_mt_published_version)
  if [[ -n "$published" ]]; then
    candidate=$(personal_mt_max_version "$candidate" "$published")
  elif [[ "${T3_MT_ALLOW_OFFLINE_VERSION:-}" != "1" ]]; then
    # No published version means gh could not reach GitHub (a locked keychain
    # under launchd at night, or no network). The fallback is the stale
    # package.json version: on 2026-10-04 that built and installed 0.0.46 on
    # every machine. Refuse instead.
    echo "could not read the published MT Code version from GitHub; refusing to fall back to apps/desktop/package.json ($pkg). Set T3_MT_ALLOW_OFFLINE_VERSION=1 to override." >&2
    return 1
  fi

  # A deliberate jump, e.g. 0.0.99 -> 0.1.0: T3_MT_RELEASE_VERSION=0.1.0 on the
  # release run. It can only move forward; once published, later runs count on
  # from it (0.1.1, 0.1.2, ...) with no override needed.
  if [[ -n "${T3_MT_RELEASE_VERSION:-}" ]]; then
    if [[ ! "$T3_MT_RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "T3_MT_RELEASE_VERSION must look like 0.1.0, got '$T3_MT_RELEASE_VERSION'" >&2
      return 1
    fi
    candidate=$(personal_mt_max_version "$candidate" "$T3_MT_RELEASE_VERSION")
  fi

  # Publishing needs the NEXT free number instead of the current one. Reusing a
  # published tag is destructive: the publish script takes its "release exists"
  # branch and 'gh release upload --clobber' swaps only the platform being
  # built, leaving the other platform's older installer under one version.
  # Fleet refreshes deliberately do NOT set this — they build the version that
  # is actually released, so Mac/Blade/Dell match the download page.
  if [[ "${T3_MT_VERSION_NEXT:-}" == "1" && -n "$published" && "$candidate" == "$published" ]]; then
    local major minor patch
    IFS=. read -r major minor patch <<<"$published"
    candidate="${major:-0}.${minor:-0}.$(( ${patch:-0} + 1 ))"
  fi
  echo "$candidate"
}

personal_mt_export_desktop_version() {
  if [[ -z "${T3CODE_DESKTOP_VERSION:-}" ]]; then
    T3CODE_DESKTOP_VERSION="$(personal_mt_resolve_version)" || return 1
  fi
  T3CODE_DESKTOP_VERSION="$(personal_mt_strip_nightly_prerelease "$T3CODE_DESKTOP_VERSION")"
  export T3CODE_DESKTOP_VERSION
}
