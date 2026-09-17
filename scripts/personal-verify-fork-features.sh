#!/usr/bin/env bash
# Verify the MT Code fork's custom features are still WIRED, not just present.
#
# Why this exists: upstream merges into this fork have repeatedly kept a
# feature's modules, types, and tests while dropping the few lines that CALL
# them. Typecheck stays clean, unit tests stay green, and the feature is
# silently gone from the app (this happened to Goals, the usage "All" window,
# the composer /goal menu, the # thread-reference chip, and the web dictation
# mic). Each check below pins a feature's
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

# --- One-tap Continue as a Continuation Turn (upstream #11716, taken 2026-09-16) ---
# Upstream submits a "Continue" user message; the fork dispatches
# thread.turn.continue so the Turn has no user message (docs/adr/0005). A merge
# that re-takes upstream's composer handler would quietly bring the message back.
require apps/web/src/components/ChatView.tsx "onContinueInterruptedTurn={onContinueInterruptedTurn}" "composer Continue dispatches the continuation command"
require apps/server/src/orchestration/decider.ts 'case "thread.turn.continue"' "decider handles the one-tap continuation command"
require apps/server/src/orchestration/Layers/ProviderCommandReactor.ts "buildInterruptedTurnContinuationPrompt" "provider reactor authors the interrupted-turn prompt"

# --- Cross-thread tools (a0d8862a1, ae1be5092, 146cd13a6) ---
require apps/server/src/mcp/McpHttpServer.ts "ThreadReferenceToolkit" "thread_read toolkit registered"
require apps/server/src/mcp/McpHttpServer.ts "ThreadRelayToolkit" "thread_list/thread_send toolkit registered"
require apps/web/src/components/chat/ChatComposer.tsx "searchThreadReferences" "# thread-reference search in composer"

# --- Voice dictation, web composer (5fe86fbb6, c239c12e0) ---
require apps/web/src/components/chat/ChatComposer.tsx "VoiceTranscriptionPanel" "dictation panel rendered by web composer"

# --- Computer-use permission/tool approvals (b671c08ef lineage) ---
require apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts 'case "permissions_approval"' "permissions approval request kind mapping"
require apps/server/src/provider/Layers/CodexSessionRuntime.ts "mcpApprovalRequestKind" "MCP tool/permissions approval routing in Codex runtime"

# --- Resume-on-restart (65d715fb2) ---
require apps/server/src/serverRuntimeStartup.ts "sessionStartupReconciler" "startup reconciler runs at boot"

# --- Computer-use agent cursor (b671c08ef) ---
require native/t3-chrome-extension/background.js "paintCursor" "agent pointer painted into pages by the Chrome extension"
require native/t3-desktop-mcp-rs/src/main.rs "agent_cursor" "native desktop pointer overlay driven by tool lifecycle"

# --- Computer-use desktop MCP auto-injection into agent sessions (b671c08ef lineage, 2026-08-25) ---
# Every spawned session gets the bundled `mt-desktop` MCP server; user-defined
# servers with the same name win over injection.
require apps/server/src/provider/Layers/ClaudeAdapter.ts "resolveDesktopMcp" "desktop MCP injected into Claude sessions"
require apps/server/src/provider/Layers/ClaudeAdapter.ts "userDefinesDesktopMcp" "user-config-wins guard on Claude desktop MCP injection"
require apps/server/src/provider/Layers/CodexAdapter.ts "resolveDesktopMcp" "desktop MCP injected into Codex sessions"
require apps/server/src/provider/Layers/CodexAdapter.ts "hasConfiguredMcpServerNamed" "user-config-wins guard on Codex desktop MCP injection"
require apps/server/src/provider/Layers/CursorAdapter.ts "resolveDesktopMcp" "desktop MCP injected into Cursor sessions"
require apps/server/src/provider/Layers/GrokAdapter.ts "resolveDesktopMcp" "desktop MCP injected into Grok sessions"

# --- Computer-use thread view (9c23b7fa6, eb1bdd5e2) ---
require apps/server/src/ws.ts "computerViewStream" "computer view RPCs registered"
require apps/web/src/components/chat/ChatHeader.tsx "ComputerViewDialog" "computer view mounted in chat header"

# --- Sidebar linked-PR badge (upstream #4755/#8160 wiring, restored 2026-09-02) ---
# Rows read the linked PR from the host and hold merged/closed state in the
# parent atom; a merge dropped this once and left the sidebar blind to links.
require apps/web/src/components/Sidebar.tsx "useLinkedThreadPullRequest(" "sidebar rows read linked PR status"
# Upstream #10101 (223ff4490) moved PR linking to the server, deleting the
# client-side ThreadChangeRequestSnapshot atom this used to check. The badge
# itself is the fork feature, so the check now follows it to its new source.
require apps/web/src/components/Sidebar.tsx "prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider)" "sidebar renders the linked-PR badge"

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

# --- munim new-thread env helpers (e51e0fc8e) ---
require apps/web/src/hooks/useHandleNewThread.ts "shouldReadProjectFileForNewThreadDefaults" "new-thread project-file defaults"

# --- File/PDF attachments (c32c7e223, restored 2026-08-29) ---
# A 2026-08-17 integrate left contracts on the old "pdf" attachment model while
# the server moved to upstream's generic "file" type, so the server bundle threw
# "PROVIDER_SEND_TURN_MAX_FILE_BYTES is not defined" on boot and crash-looped.
require packages/contracts/src/orchestration.ts "ChatFileAttachment" "generic file attachment schema"
require packages/contracts/src/orchestration.ts "ChatUnknownAttachment" "forward-compatible unknown attachment schema"
require apps/server/src/attachmentStore.ts 'case "file"' "file attachments get a stored path"
require apps/server/src/provider/Layers/CursorAdapter.ts 'attachment.type !== "image"' "non-image attachments sent as ACP resource links"
require apps/web/src/components/chat/MessagesTimeline.tsx "filter(isImageAttachment)" "timeline image grid filters non-images"

# --- WS client analytics props (restored 2026-08-29) ---
# The merge dropped this argument from the makeWsRpcLayer call, so per-client
# telemetry never reached the RPC layer.
require apps/server/src/ws.ts "clientAnalyticsProps," "client analytics props passed into the ws rpc layer"

# --- Update changelog on every channel (5e8467899) ---
# Upstream gates the release-notes popover/tooltip to nightly; MT Code ships a
# single latest track with fullChangelog on, so the gate must stay removed.
require apps/web/src/components/sidebar/SidebarUpdatePill.tsx 'state !== null && state.releaseNotes.length > 0' "release-notes popover not gated to nightly"
require apps/web/src/components/sidebar/SidebarUpdateReleaseNotes.tsx 'if (state.releaseNotes.length === 0) {' "release-notes body not gated to nightly"

# --- Processes dialog (ported from t3neo) ---
require apps/web/src/components/chat/ChatHeader.tsx "<ProcessesButton />" "Processes dialog button mounted in chat header actions"
require apps/server/src/terminal/Manager.ts "registerProcessOrigin(processPid" "terminal PTY registered as a process origin"

# --- Per-turn usage badges (ported from t3neo) ---
require apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts "buildTurnUsagePayload" "turn usage activity emitted by the ingestion"
require apps/web/src/components/ChatView.tsx "turnUsageByTurnId={turnUsageByTurnId}" "turn usage badges passed to the timeline"
require apps/web/src/components/chat/ChatComposer.tsx "<ComposerUsageBadge" "live usage pill in the composer footer"

# --- Desktop auto-download / auto-install (personal fork) ---
# The 2026-09-01 sync silently broke auto-install when upstream turned
# installDownloadedUpdate into a function (the fork line yielded the function).
require apps/desktop/src/updates/DesktopUpdates.ts 'const fullChangelog = true;' "release notes fetched on every update channel"
require apps/desktop/src/updates/DesktopUpdates.ts 'yield\* downloadAvailableUpdate;' "auto-download when an update becomes available"
require apps/desktop/src/updates/DesktopUpdates.ts 'yield\* installDownloadedUpdate(info.version);' "auto-install pinned to the downloaded version"
# Remote-update flow must treat the fork's in-flight auto-install as prepared.
require apps/desktop/src/updates/DesktopRemoteUpdates.ts 'ready-to-install' "remote update publishes ready-to-install"
require scripts/build-desktop-artifact.ts "VC.Runtimes.x86.x64.Spectre" "Windows build preflight probes the real VS 2022 Spectre component id (upstream's VC.Tools.*.Spectre does not exist)"

# --- MT wordmark alignment (brand tuning, do NOT adopt upstream's sizing) ---
# The MT mark is hand-tuned: 12px tall and nudged down 2px, because the glyph is
# top-heavy (ink centroid at 45%) so cap-height box sizing reads high. The
# 2026-09-15 sync replaced it with upstream's `h-[1cap]` and shrank the mark.
# Upstream's T3Wordmark keeps 1cap; only MTWordmark is exempt.
require apps/web/src/components/sidebar/SidebarChrome.tsx 'h-3 w-auto shrink-0 translate-y-\[2px\]' "MT wordmark keeps its hand-tuned 12px height and 2px nudge"

# --- Plugin marketplace (2026-09-16, a3455de80b / 06fffa29e3) ---
# Codex plugins are read through the app-server with lenient decoders; the
# CLI-only path silently dropped every Codex plugin once codex 0.154 emitted
# path-less remote records. The palette action and harness tabs are fork-only UI.
require apps/server/src/plugins/CodexPluginMarketplace.ts "decodeCodexRuntimeCatalog" "Codex app-server catalog decoding in the plugin marketplace"
require apps/web/src/components/CommandPalette.tsx 'title: "Browse plugins"' "Browse plugins command-palette action"
require apps/web/src/components/settings/pluginMarketplace/PluginMarketplace.tsx 'aria-label="Harness"' "harness tabs on the plugin marketplace page"

# --- Usage limits for every driver (2026-09-16, 20308ea78b) ---
# Cursor and OpenCode publish subscription windows into upstream's Limits
# view; the fork-only AccountLimits strip/hover card was removed the same day.
require apps/server/src/provider/Drivers/CursorDriver.ts "readCursorUsageLimits" "Cursor usage-limit probe wired into CursorProvider"
require apps/server/src/provider/Drivers/OpenCodeDriver.ts "loadOpenCodeUsageLimits" "OpenCode usage-limit probe wired into OpenCodeProvider"

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "fork-feature verification FAILED — an upstream merge dropped call sites." >&2
  echo "Restore the wiring before pushing to fork/main (git log -S '<pattern>' finds the last-good commit)." >&2
  exit 1
fi
echo "fork-feature verification OK (all custom call sites present)"
