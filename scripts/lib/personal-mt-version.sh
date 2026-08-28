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
  # (MT releases have run ahead before). Reusing that number silently republishes
  # an existing tag: gh release upload --clobber then swaps one platform's assets
  # and leaves the other platform's older build in place, under one version.
  # Never go backwards — bump past the highest published release instead.
  published=$(personal_mt_published_version)
  if [[ -n "$published" ]] && [[ "$(personal_mt_max_version "$candidate" "$published")" != "$candidate" || "$candidate" == "$published" ]]; then
    local major minor patch
    IFS=. read -r major minor patch <<<"$published"
    candidate="${major:-0}.${minor:-0}.$(( ${patch:-0} + 1 ))"
  fi
  echo "$candidate"
}

personal_mt_export_desktop_version() {
  if [[ -z "${T3CODE_DESKTOP_VERSION:-}" ]]; then
    T3CODE_DESKTOP_VERSION="$(personal_mt_resolve_version)"
  fi
  T3CODE_DESKTOP_VERSION="$(personal_mt_strip_nightly_prerelease "$T3CODE_DESKTOP_VERSION")"
  export T3CODE_DESKTOP_VERSION
}
