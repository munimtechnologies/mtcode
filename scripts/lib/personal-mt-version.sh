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

personal_mt_resolve_version() {
  local root="${REPO:-.}"
  local pkg tag base
  pkg=$(
    cd "$root" &&
      node -p "require('./apps/desktop/package.json').version.replace(/-nightly\\.[0-9.]+$/, '')"
  )
  tag=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty' 2>/dev/null || true)
  if [[ -n "$tag" ]]; then
    base="${tag#v}"
    personal_mt_strip_nightly_prerelease "$base"
    return
  fi
  echo "$pkg"
}

personal_mt_export_desktop_version() {
  if [[ -z "${T3CODE_DESKTOP_VERSION:-}" ]]; then
    T3CODE_DESKTOP_VERSION="$(personal_mt_resolve_version)"
  fi
  T3CODE_DESKTOP_VERSION="$(personal_mt_strip_nightly_prerelease "$T3CODE_DESKTOP_VERSION")"
  export T3CODE_DESKTOP_VERSION
}
