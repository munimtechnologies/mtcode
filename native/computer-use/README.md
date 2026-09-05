# Computer Use

[![Release](https://img.shields.io/github/v/release/munimtechnologies/computer-use?label=release)](https://github.com/munimtechnologies/computer-use/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio%20server-8A2BE2)](https://modelcontextprotocol.io)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

**Let any coding agent use your computer.** An open-source [MCP](https://modelcontextprotocol.io) server that reads the screen through accessibility trees, clicks and types _in the background_ so your mouse stays yours, shows an agent pointer where it is working, zooms in on small text, and drives tabs in your signed-in Chrome — on **macOS, Windows and Linux**.

Works with **Claude Code, Codex, Cursor, [MT Code](https://munimtech.com/mt-code)** and any other MCP client. Made by [Munim Technologies](https://munimtech.com/computer-use).

## Quick start

1. Download the latest binary for your platform from [Releases](https://github.com/munimtechnologies/computer-use/releases/latest) (`computer-use-macos-universal.zip`, `computer-use-windows-x64.zip`) or [build from source](#build-from-source).
2. Put it somewhere on your `PATH` (`/usr/local/bin/computer-use`, or `%LOCALAPPDATA%\Programs\computer-use\computer-use.exe`).
3. macOS only: run `computer-use request-permissions` once to be prompted for Accessibility and Screen Recording.
4. Register it with your agent:

```sh
# Claude Code
claude mcp add computer-use -- /usr/local/bin/computer-use
```

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.computer-use]
command = "/usr/local/bin/computer-use"
```

```json
// Cursor — .cursor/mcp.json
{ "mcpServers": { "computer-use": { "command": "/usr/local/bin/computer-use" } } }
```

Then ask: _"Open Safari, find the cheapest flight to Denver on Tuesday and put it in a note."_ The agent reads the UI with `get_app_state`, acts by element id, and verifies with `screenshot`.

## How it compares

Every row below is taken from that project's own README in September 2026 (links at the bottom). "Background input" means the agent can act on a window while you keep using the mouse and keyboard elsewhere. "Coordinate mapping" means screenshots tell the model how image pixels map to screen coordinates, so clicks from a Retina or downscaled capture land where intended.

|                                     | Platforms                       | Perceives UI via                                           | Background input                                          | Agent pointer         | Zoom + coordinate mapping | Your signed-in Chrome                       | Any MCP client  | Open source |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | --------------------- | ------------------------- | ------------------------------------------- | --------------- | ----------- |
| **Computer Use (this)**             | macOS, Windows, Linux           | Accessibility tree with element ids, screenshots to verify | **Yes** — window-addressed events; your mouse never moves | **Yes**, soft overlay | **Yes**                   | **Yes** — own tab group in your real Chrome | Yes             | MIT         |
| OpenAI Codex Computer Use           | macOS, Windows                  | Screenshots                                                | No — drives its own cursor on your screen                 | Yes                   | Model-side                | Codex in-app browser                        | No — Codex only | No          |
| Anthropic computer-use reference    | Linux desktop in Docker         | Screenshots (xdotool)                                      | Sandbox only, not your desktop                            | No                    | `zoom` action             | No                                          | Claude only     | Yes         |
| CursorTouch/Windows-MCP             | Windows                         | UIA snapshot + screenshots                                 | No                                                        | Capture border flash  | No                        | DOM mode for browsers                       | Yes             | MIT         |
| CursorTouch/MacOS-MCP               | macOS                           | Accessibility tree                                         | No — moves the real mouse                                 | No                    | No                        | Scrape to Markdown only                     | Yes             | MIT         |
| QwenLM/open-computer-use            | macOS, Windows, Linux           | Accessibility + screenshots                                | No — controls the real cursor                             | No                    | No                        | No                                          | Yes             | MIT         |
| zavora-ai/computer-use-mcp          | macOS, Windows, Linux           | Screenshots + accessibility tree                           | No — SendInput / native input                             | No                    | No                        | No                                          | Yes             | MIT         |
| mediar-ai/mcp-server-macos-use      | macOS                           | Accessibility tree                                         | No                                                        | No                    | No                        | No                                          | Yes             | Yes         |
| deploymenttheory/windows-mcp-server | Windows                         | UIA tree, Invoke patterns                                  | Partly — Invoke needs no focus                            | No                    | No                        | Scrape only                                 | Yes             | Yes         |
| nuphus-mcp                          | Windows, macOS, Linux (partial) | OCR + your own vision model                                | No                                                        | OSD bar               | No                        | Own or CDP-attached Chrome profile          | Yes             | MIT         |
| computer-control-mcp                | macOS, Windows, Linux           | Screenshots + OCR (PyAutoGUI)                              | No — moves the real mouse                                 | No                    | No                        | No                                          | Yes             | MIT         |
| microsoft/playwright-mcp            | Browser only                    | Accessibility snapshot                                     | n/a                                                       | n/a                   | n/a                       | Persistent Playwright profile               | Yes             | Apache-2.0  |

Where this server is unique: it is the only open-source option that combines accessibility-first perception, background input that leaves your mouse alone, an agent pointer, correct coordinate mapping, and your real signed-in browser — across all three desktop platforms, with one identical tool surface. Corrections welcome: open an issue with a link.

## Why it works well

- **Accessibility first, pixels second.** `get_app_state` returns the app's accessibility tree with stable element ids, so the agent presses _the button_ instead of guessing at a coordinate. It costs a fraction of the tokens of a screenshot and it is what scores highest on OSWorld-style tasks. Screenshots are for verifying and for content the tree cannot describe.
- **Background control.** Events are addressed to the target window (SkyLight on macOS, posted window messages on Windows, XTEST on Linux). No focus stealing, no hijacked mouse.
- **Pointer overlay, not your pointer.** A soft lavender agent pointer shows where the agent is acting. Your cursor is untouched.
- **Coordinates that land.** Every screenshot and zoom carries its screen origin and pixels-per-point. `zoom` captures any region at full physical resolution.
- **Your browser, your logins.** The Chrome extension gives the agent its own labelled tab group in your signed-in Chrome and never touches your tabs.
- **Model-agnostic.** No vision model is required for interaction; local models work too.
- **Look → act → verify.** `hover` for mouse-over menus, `wait` for loads, `query` to find a control by label without reading a whole tree.

## Tools (26)

| Area    | Tools                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| See     | `list_apps`, `get_app_state` (with `query`), `screenshot`, `zoom`, `list_displays`                                                                                                                         |
| Act     | `click`, `right_click`, `hover`, `drag`, `scroll`, `type_text`, `set_value`, `select_text`, `press_key`, `activate_app`, `wait`                                                                            |
| Browser | `browser_open_tab`, `browser_list_tabs`, `browser_select_tab`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press_key`, `browser_close_tab`, `browser_close_all_tabs` |

Names, argument shapes and descriptions are identical on every platform; a model that learned them on a Mac needs nothing new on Windows.

## Repository layout

| Directory           | What                                                                   | Build                                                             |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `macos/`            | Swift server on the Accessibility API and ScreenCaptureKit (macOS 14+) | `swift build -c release` → `.build/release/computer-use`          |
| `windows-linux/`    | Rust server: UI Automation on Windows, AT-SPI + X11 on Linux           | `cargo build --release` → `target/release/computer-use`           |
| `chrome-extension/` | Chrome extension + native messaging host for the `browser_*` tools     | Load unpacked; `sh install.sh` / `install.ps1` registers the host |

### Build from source

```sh
# macOS
cd macos && swift build -c release
# Windows / Linux
cd windows-linux && cargo build --release
```

Linux notes: element actions work everywhere; coordinate clicks need an X11 or XWayland client, since native Wayland apps do not expose absolute geometry.

### Chrome extension (optional)

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `chrome-extension/`.
2. Register the native messaging host: `sh chrome-extension/install.sh` (macOS/Linux) or `powershell -File chrome-extension/install.ps1` (Windows). Point `COMPUTER_USE_PATH` at the binary if it is not in the default build location.

## Environment flags

| Variable                                   | Effect                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| `COMPUTER_USE_BROWSER=0`                   | Hide the `browser_*` tools                                      |
| `COMPUTER_USE_AGENT_CURSOR=0`              | Do not draw the agent pointer                                   |
| `COMPUTER_USE_AGENT_CURSOR_TASK_FADE_SECS` | How long the pointer stays after the last tool call (default 8) |
| `COMPUTER_USE_ALLOW_SECURE_FIELD_INPUT=1`  | Allow typing into password fields (refused by default)          |
| `COMPUTER_USE_COMPUTER_USE_YIELD_SECS`     | Pause the agent while the user is actively using the machine    |

## Prompting your agent

Look → act → verify. `get_app_state` for ids, act by id, then `get_app_state` or `screenshot` again before the next step. Use `zoom` for small text, `hover` for menus that appear on mouse-over, `wait` after loads, keyboard shortcuts for stubborn widgets. The system-prompt text MT Code gives its agents lives in [`CodexDeveloperInstructions.ts`](https://github.com/munimtechnologies/mtcode/blob/main/apps/server/src/provider/CodexDeveloperInstructions.ts) and is a good starting point.

## Contributing

This repository mirrors the `native/` tree of [munimtechnologies/mtcode](https://github.com/munimtechnologies/mtcode), where the server is developed and shipped inside MT Code. Issues and discussions are welcome here; code changes land in mtcode first and are synced.

## Credits and license

Designed and built by [Munim Technologies, Inc.](https://munimtech.com) for MT Code. MIT licensed; see `LICENSE`.

Comparison sources: [Codex Computer Use](https://openai.com/index/codex-for-almost-everything/) · [Anthropic computer-use demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo) · [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) · [CursorTouch/MacOS-MCP](https://github.com/CursorTouch/MacOS-MCP) · [QwenLM/open-computer-use](https://github.com/QwenLM/open-computer-use) · [zavora-ai/computer-use-mcp](https://github.com/zavora-ai/computer-use-mcp) · [mediar-ai/mcp-server-macos-use](https://github.com/mediar-ai/mcp-server-macos-use) · [deploymenttheory/windows-mcp-server](https://github.com/deploymenttheory/windows-mcp-server) · [nuphus-mcp](https://github.com/mrpulor-gh/nuphus-mcp) · [computer-control-mcp](https://github.com/AB498/computer-control-mcp) · [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
