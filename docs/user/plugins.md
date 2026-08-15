# Plugins

Open **Settings → Plugins** to browse Codex, Claude Code, and Cursor plugins from the current
environment. You can also use the Plugins button at the bottom of the sidebar or open the command
palette and choose **Browse plugins**.

The marketplace reads installed and available packages from configured Codex and Claude Code
marketplaces. It also reads Cursor's public marketplace and local Cursor plugin cache. Search by
name, filter by MCP server, skill, app, harness, or category, and select a plugin to inspect its
contents. Plugin artwork and metadata come from the package or its published marketplace listing.
Use the **Installed** view to see every active package without repeating those packages throughout
the browse categories. Equivalent category names from different marketplaces are combined into one
category.

When the same package is published for more than one harness, T3 Code groups those listings into one
marketplace entry. The detail page has a separate installation switch for each supported harness,
so you can install the plugin on one harness, several harnesses, or every directly manageable
harness. Select **View package contents** on a harness row to inspect that harness's published MCP
servers and components.

Package contents are shown in the terms used by each harness. Codex bundles skills, MCP connections,
apps, and optional hooks. Claude Code packages can also include namespaced commands, subagents,
language servers, and monitors. Cursor packages can include editor rules, commands, subagents,
hooks, skills, and MCP servers. T3 Code reads Cursor's published inventory directly and inspects the
source of remote Claude packages when you open their details.

Installation switches update the real Codex or Claude Code configuration on that environment.
When a Codex message names an installed plugin, T3 Code forwards that plugin's enabled skills with
the turn, including in an existing thread. Start a new chat after changing MCP servers or apps so
the harness can refresh those longer-lived connections.

On macOS, the Computer Use detail page includes **Permission setup**. Open the signed Computer Use
setup app there to grant Accessibility and Screen Recording, or jump directly to the Accessibility
and Automation pages in System Settings. T3 Code declares its Automation purpose to macOS so the
system can show consent prompts for the applications you choose. When browsing a remote
environment, these actions open on the Mac hosting that environment.

Cursor does not currently provide a non-interactive plugin install command, so Cursor rows open the
official Cursor Marketplace for installation or removal. Secret environment variable values are
never displayed.
