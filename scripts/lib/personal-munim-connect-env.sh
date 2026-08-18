# Munim T3 Connect client configuration loader. Source this file, then call
# munim_connect_load.
#
# The canonical config lives OUTSIDE the repo at ~/.mt/munim-connect.env
# (template: scripts/personal-munim-connect.env.example). When that file is
# absent or incomplete, nothing is exported and builds stay exactly as today
# (pairing mode, or whatever the repo-root .env provides). When it is present
# and complete, the canonical T3CODE_* values are exported into the process
# environment, which scripts/lib/public-config.ts (loadRepoEnv) ranks above
# any repo-root .env, so web/desktop/server builds bake the Munim Clerk +
# relay identifiers instead of T3's.
#
# These values are public identifiers (Clerk publishable key, JWT template
# name, relay URL, OAuth public client ID). Never put CLERK_SECRET_KEY or any
# other secret in ~/.mt/munim-connect.env — relay-side secrets belong in
# ~/.mt/munim-relay.env (see scripts/personal-deploy-relay.sh).

MUNIM_CONNECT_ENV_FILE="${MUNIM_CONNECT_ENV_FILE:-$HOME/.mt/munim-connect.env}"
MUNIM_CONNECT_ACTIVE=0

# T3/pingdotgg production identifiers (repo .env.example). This tooling exists
# to run Connect on Munim-owned infrastructure only, so refuse a config file
# that smuggles T3's values back in.
MUNIM_CONNECT_T3_PK="pk_live_Y2xlcmsudDMuY29kZXMk"
MUNIM_CONNECT_T3_RELAY_HOST="relay.t3.codes"
MUNIM_CONNECT_T3_OAUTH_ID="hzxSgY2cH10sDU2r"

# Load and validate ~/.mt/munim-connect.env. Returns 0 always except when the
# file contains T3's production values, which is a hard error (callers run
# under `set -e`, so that aborts the build).
munim_connect_load() {
  if [[ ! -f "$MUNIM_CONNECT_ENV_FILE" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  . "$MUNIM_CONNECT_ENV_FILE"
  set +a

  local missing=()
  [[ -n "${T3CODE_CLERK_PUBLISHABLE_KEY:-}" ]] || missing+=(T3CODE_CLERK_PUBLISHABLE_KEY)
  [[ -n "${T3CODE_CLERK_JWT_TEMPLATE:-}" ]] || missing+=(T3CODE_CLERK_JWT_TEMPLATE)
  [[ -n "${T3CODE_RELAY_URL:-}" ]] || missing+=(T3CODE_RELAY_URL)
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "munim-connect: $MUNIM_CONNECT_ENV_FILE is missing ${missing[*]} — building without Munim Connect" >&2
    unset T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_RELAY_URL \
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID
    return 0
  fi

  if [[ "$T3CODE_CLERK_PUBLISHABLE_KEY" == "$MUNIM_CONNECT_T3_PK" ||
    "$T3CODE_RELAY_URL" == *"$MUNIM_CONNECT_T3_RELAY_HOST"* ||
    "${T3CODE_CLERK_CLI_OAUTH_CLIENT_ID:-}" == "$MUNIM_CONNECT_T3_OAUTH_ID" ]]; then
    echo "munim-connect: $MUNIM_CONNECT_ENV_FILE contains T3/pingdotgg production values — refusing to build with them" >&2
    return 1
  fi

  export T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_RELAY_URL
  if [[ -n "${T3CODE_CLERK_CLI_OAUTH_CLIENT_ID:-}" ]]; then
    export T3CODE_CLERK_CLI_OAUTH_CLIENT_ID
  fi
  MUNIM_CONNECT_ACTIVE=1
  echo "munim-connect: active (relay: $T3CODE_RELAY_URL)"
  return 0
}

# Rewrite <repo>/.env from the loaded Munim values so manual builds from that
# checkout also pick them up and none of T3's identifiers linger. Only touches
# a .env that is missing, an untouched copy of .env.example, or one this
# helper wrote earlier; a hand-edited .env is left alone (the exported process
# env still overrides the Connect identifiers for builds run through these
# scripts).
munim_connect_write_repo_env() {
  local repo="$1"
  if [[ "$MUNIM_CONNECT_ACTIVE" != 1 ]]; then
    return 0
  fi
  local env_file="$repo/.env"
  if [[ -f "$env_file" ]]; then
    if ! head -n 1 "$env_file" | grep -q "munim-connect: managed" &&
      ! cmp -s "$env_file" "$repo/.env.example"; then
      echo "munim-connect: leaving hand-edited $env_file in place (process env still overrides Connect identifiers)" >&2
      return 0
    fi
  fi
  {
    echo "# munim-connect: managed — regenerated from $MUNIM_CONNECT_ENV_FILE by scripts/lib/personal-munim-connect-env.sh"
    echo "T3CODE_CLERK_PUBLISHABLE_KEY=$T3CODE_CLERK_PUBLISHABLE_KEY"
    echo "T3CODE_CLERK_JWT_TEMPLATE=$T3CODE_CLERK_JWT_TEMPLATE"
    echo "T3CODE_RELAY_URL=$T3CODE_RELAY_URL"
    if [[ -n "${T3CODE_CLERK_CLI_OAUTH_CLIENT_ID:-}" ]]; then
      echo "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=$T3CODE_CLERK_CLI_OAUTH_CLIENT_ID"
    fi
  } >"$env_file"
  echo "munim-connect: wrote $env_file"
  return 0
}

# Mirror ~/.mt/munim-connect.env to a Windows build host's %USERPROFILE%\.mt\
# so its clone builds with the same identifiers. Best-effort: an unreachable
# host must not abort the fleet refresh.
munim_connect_sync_to_windows_host() {
  local host="$1"
  if [[ ! -f "$MUNIM_CONNECT_ENV_FILE" ]]; then
    return 0
  fi
  if ssh -o BatchMode=yes -o ConnectTimeout=30 "$host" 'cmd.exe /c if not exist .mt mkdir .mt' &&
    scp -o BatchMode=yes -o ConnectTimeout=30 "$MUNIM_CONNECT_ENV_FILE" "$host:.mt/munim-connect.env"; then
    echo "munim-connect: synced config to $host"
  else
    echo "munim-connect: could not sync config to $host — its build may lack Munim Connect values" >&2
  fi
  return 0
}
