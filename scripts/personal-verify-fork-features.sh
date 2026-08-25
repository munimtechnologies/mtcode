#!/usr/bin/env bash
# Verify the MT Code fork's custom features are still WIRED, not just present.
#
# Why this exists: upstream merges into this fork have repeatedly kept a
# feature's modules, types, and tests while dropping the few lines that CALL
# them. Typecheck stays clean, unit tests stay green, and the feature is
# silently gone from the app (this happened to Goals, the usage "All" window,
# the composer /goal menu, the # thread-reference chip, the web dictation mic,
# and MT Auto in the model picker). Each check below pins a feature's
# call-site — the line a merge is most likely to lose — not its module.
#
# Run it:
#   - after EVERY upstream merge, before pushing to fork/main
#   - personal-refresh-all.sh runs it before building; a failure aborts the
#     fleet refresh so a broken merge never ships to Mac/Blade/Dell
#
# When a check fails after a merge: the merge dropped that feature's wiring.
# Restore the call site (git log -S the pattern to find the last-good commit),
# do not delete the check. Only remove a check when Sheehan explicitly retires
# the feature.
set -uo pipefail

REPO="${T3_PERSONAL_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

fail=0

require() {
  # require <file> <grep-pattern> <feature description>
  local file="$1" pattern="$2" desc="$3"
  if [[ ! -f "$file" ]]; then
    echo "MISSING FILE: $file  ($desc)" >&2
    fail=1
    return
  fi
  if ! grep -q -- "$pattern" "$file"; then
    echo "DROPPED: '$pattern' not found in $file  ($desc)" >&2
    fail=1
  fi
}

# --- Usage "All" window (a7e8c621b) ---
require packages/shared/src/usageFormat.ts "ALL_USAGE_WINDOW_DAYS" "All-window sentinel in shared usage format"
require apps/web/src/components/usage/UsagePage.tsx 'label: "All"' "All option in web usage window picker"
require apps/mobile/src/features/usage/UsageRouteScreen.tsx 'label: "All"' "All option in mobile usage window picker"
require apps/server/src/usage/UsageService.ts "retentionCutoffMs" "All-window scan-cache retention in UsageService"

# --- Goals (86e27ef70, 579221de3, 07d149458) ---
require apps/server/src/orchestration/projector.ts "thread.goal-set" "goal events in in-memory projector"
require apps/server/src/orchestration/projector.ts "thread.queued-turn-dispatched" "queued-turn events in in-memory projector"
require apps/server/src/orchestration/Layers/ProviderCommandReactor.ts "buildGoalContinuationPrompt" "goal continuation prompt in provider reactor"
require apps/web/src/components/ChatView.tsx "parseGoalComposerCommand" "/goal interception in ChatView submit path"
require apps/web/src/components/CommandPalette.tsx "runGoalAction" "Objective actions in command palette"
require apps/web/src/components/Sidebar.tsx "GoalActiveMarker" "goal marker in sidebar"
require apps/web/src/components/chat/ChatComposer.tsx "buildBuiltInSlashCommandItems" "/goal items in composer slash menu"
require apps/web/src/components/chat/ChatComposer.tsx "ComposerGoalBadge" "goal badge rendered by composer"

# --- Cross-thread tools (a0d8862a1, ae1be5092, 146cd13a6) ---
require apps/server/src/mcp/McpHttpServer.ts "ThreadReferenceToolkit" "thread_read toolkit registered"
require apps/server/src/mcp/McpHttpServer.ts "ThreadRelayToolkit" "thread_list/thread_send toolkit registered"
require apps/web/src/components/chat/ChatComposer.tsx "searchThreadReferences" "# thread-reference search in composer"

# --- Voice dictation, web composer (5fe86fbb6, c239c12e0) ---
require apps/web/src/components/chat/ChatComposer.tsx "VoiceTranscriptionPanel" "dictation panel rendered by web composer"

# --- MT Auto model routing (70dd0b424, 0d1b9c8bd) ---
require apps/web/src/components/chat/ChatComposer.tsx "prependMtModelPickerEntry" "MT Auto entry in composer model picker"
require apps/server/src/orchestration/Layers/ProviderCommandReactor.ts "mtModel" "MT Auto routing in provider reactor"

# --- Computer-use permission/tool approvals (b671c08ef lineage) ---
require apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts 'case "permissions_approval"' "permissions approval request kind mapping"
require apps/server/src/provider/Layers/CodexSessionRuntime.ts "mcpApprovalRequestKind" "MCP tool/permissions approval routing in Codex runtime"

# --- Resume-on-restart (65d715fb2) ---
require apps/server/src/serverRuntimeStartup.ts "sessionStartupReconciler" "startup reconciler runs at boot"

# --- Computer-use agent cursor (b671c08ef) ---
require native/t3-chrome-extension/background.js "paintCursor" "agent pointer painted into pages by the Chrome extension"
require native/t3-desktop-mcp-rs/src/main.rs "agent_cursor" "native desktop pointer overlay driven by tool lifecycle"

# --- Computer-use thread view (9c23b7fa6, eb1bdd5e2) ---
require apps/server/src/ws.ts "computerViewStream" "computer view RPCs registered"
require apps/web/src/components/chat/ChatHeader.tsx "ComputerViewDialog" "computer view mounted in chat header"

# --- Artwork + app icon pickers (44cf90dc0, 0efc0e293) ---
require apps/web/src/components/settings/SettingsPanels.tsx "SidebarArtworkRow" "artwork picker in settings"
require apps/web/src/components/settings/SettingsPanels.tsx "AppIconRow" "app icon picker in settings"

# --- Usage refresh rule (e7c556759) ---
require apps/web/src/state/usage.ts "usageEnvironmentScope" "refresh-must-answer rule feeds usage state"

# --- Open-in-editor bundle discovery (833ef53b1) ---
require packages/contracts/src/editor.ts "VSCodium" "extended macAppName editor map"

# --- Branding (6beb464fb, f136dbff8) ---
require apps/server/src/appDisplayName.ts "appDisplayName" "backend self-naming helper"
require apps/web/index.html "boot-shell-wordmark" "MT wordmark boot splash"

# --- PR upstream cards (27553c695) ---
require apps/web/src/routes/_chat.pull-requests.tsx "PullRequestUpstreamCard" "upstream PR cards in pull-requests route"

# --- Connect providers: T3 relay baked + relay-capable default (2026-08-25) ---
require scripts/lib/connect-public-providers.ts "T3_CONNECT_PUBLIC_PROVIDER" "T3 Connect provider baked into every client build"
require apps/web/src/cloud/connectProviders.ts "relayCapable" "relay-capable provider preferred as default identity"

# --- MT Teams (Better Auth + Convex team layer, 2026-08-25) ---
require apps/web/src/components/settings/SettingsPanels.tsx "MtTeamsSettings" "MT Teams settings section mounted"
require apps/web/src/components/Sidebar.tsx "MtTeamsSidebarSection" "Team shelf mounted in sidebar"
require apps/server/src/ws.ts "mtTeams" "mtTeams RPCs registered in ws"

# --- munim new-thread env helpers (e51e0fc8e) ---
require apps/web/src/hooks/useHandleNewThread.ts "shouldReadProjectFileForNewThreadDefaults" "new-thread project-file defaults"

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "fork-feature verification FAILED — an upstream merge dropped call sites." >&2
  echo "Restore the wiring before pushing to fork/main (git log -S '<pattern>' finds the last-good commit)." >&2
  exit 1
fi
echo "fork-feature verification OK (all custom call sites present)"
