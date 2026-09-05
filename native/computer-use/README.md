<!-- Banner Image -->

<p align="center">
  <a href="https://github.com/munimtechnologies/computer-use">
    <img alt="Munim Technologies Computer Use" height="128" src="./.github/resources/banner.png?v=1">
    <h1 align="center">Computer Use</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Latest release" href="https://github.com/munimtechnologies/computer-use/releases/latest" target="_blank">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/munimtechnologies/computer-use?style=flat-square&label=Version&labelColor=000000&color=0066CC" />
  </a>
  <a aria-label="License" href="https://github.com/munimtechnologies/computer-use/blob/main/LICENSE" target="_blank">
    <img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache%202.0-success.svg?style=flat-square&color=33CC12" />
  </a>
  <a aria-label="MCP" href="https://modelcontextprotocol.io" target="_blank">
    <img alt="MCP stdio server" src="https://img.shields.io/badge/MCP-stdio%20server-8A2BE2?style=flat-square" />
  </a>
  <img alt="Platforms" src="https://img.shields.io/badge/Platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square" />
</p>

<p align="center">
  <a aria-label="download" href="https://github.com/munimtechnologies/computer-use/releases/latest"><b>Download</b></a>
&ensp;•&ensp;
  <a aria-label="documentation" href="https://github.com/munimtechnologies/computer-use#readme">Read the Documentation</a>
&ensp;•&ensp;
  <a aria-label="report issues" href="https://github.com/munimtechnologies/computer-use/issues">Report Issues</a>
&ensp;•&ensp;
  <a aria-label="website" href="https://munimtech.com/computer-use">munimtech.com/computer-use</a>
</p>

<h6 align="center">Follow Munim Technologies</h6>
<p align="center">
  <a aria-label="Follow Munim Technologies on GitHub" href="https://github.com/munimtechnologies" target="_blank">
    <img alt="Munim Technologies on GitHub" src="https://img.shields.io/badge/GitHub-222222?style=for-the-badge&logo=github&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Follow Munim Technologies on LinkedIn" href="https://linkedin.com/in/sheehanmunim" target="_blank">
    <img alt="Munim Technologies on LinkedIn" src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Visit Munim Technologies Website" href="https://munimtech.com" target="_blank">
    <img alt="Munim Technologies Website" src="https://img.shields.io/badge/Website-0066CC?style=for-the-badge&logo=globe&logoColor=white" />
  </a>
</p>

## Introduction

**Computer Use** is an open-source [MCP](https://modelcontextprotocol.io) server that lets any coding agent use your computer the way a person does. It reads the screen through accessibility trees, clicks and types **in the background** so your mouse stays yours, shows an agent pointer where it is working, zooms in on small text, and drives tabs in your signed-in Chrome — on **macOS, Windows and Linux**.

**Works with Claude Code, Codex, Cursor and [MT Code](https://munimtech.com/mt-code)**, or any other MCP client, with any model — no vision model is required for interaction.

**Built by [Munim Technologies](https://munimtech.com/computer-use)** as the Computer Use engine of MT Code, and published here on its own.

## Table of contents

- [Quick start](#quick-start)
- [Capability matrix](#capability-matrix)
- [Why it works well](#why-it-works-well)
- [Tools](#tools-26)
- [Repository layout](#repository-layout)
- [Environment flags](#environment-flags)
- [Prompting your agent](#prompting-your-agent)
- [Contributing](#contributing)
- [Credits and license](#credits-and-license)

## Quick start

1. Download the latest binary for your platform from [Releases](https://github.com/munimtechnologies/computer-use/releases/latest) (`computer-use-macos-universal.zip`, `computer-use-windows-x64.zip`) or [build from source](#build-from-source).
2. Put it somewhere on your `PATH` (`/usr/local/bin/computer-use`, or `%LOCALAPPDATA%\Programs\computer-use\computer-use.exe`).
3. macOS only: run `computer-use request-permissions` once to be prompted for Accessibility and Screen Recording.
4. Register it with your agent:

```sh
# Claude Code — fastest: the npm launcher fetches the signed binary on first run
claude mcp add computer-use -- npx -y munim-computer-use
# or point at a downloaded binary
claude mcp add computer-use -- /usr/local/bin/computer-use
```

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.computer-use]
command = "npx"
args = ["-y", "munim-computer-use"]
```

```json
// Cursor — .cursor/mcp.json
{ "mcpServers": { "computer-use": { "command": "npx", "args": ["-y", "munim-computer-use"] } } }
```

Then ask: _"Open Safari, find the cheapest flight to Denver on Tuesday and put it in a note."_ The agent reads the UI with `get_app_state`, acts by element id, and verifies with `screenshot`.

## Capability matrix

**Munim Computer Use** is the highlighted first column; the others are the computer-use servers people reach for. each cell comes from that project's own README in September 2026 (sources under [Credits and license](#credits-and-license)). ✅ present · ❌ absent or not documented · ⚠️ partial.

| Capability                                  | **Munim Computer Use** | Codex Computer Use | Anthropic reference demo | Windows-MCP | MacOS-MCP | open-computer-use | computer-use-mcp (zavora) | Notes                                                                                                                                                                               |
| ------------------------------------------- | ---------------------- | ------------------ | ------------------------ | ----------- | --------- | ----------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                                       | **✅**                 | ✅                 | ❌                       | ❌          | ✅        | ✅                | ✅                        | The Anthropic demo drives a Linux desktop inside Docker, not your machine.                                                                                                          |
| Windows                                     | **✅**                 | ✅                 | ❌                       | ✅          | ❌        | ✅                | ✅                        | Windows-MCP is Windows only; MacOS-MCP is macOS only.                                                                                                                               |
| Linux                                       | **✅**                 | ❌                 | ✅ (sandbox)             | ❌          | ❌        | ✅                | ✅                        | Munim Computer Use uses AT-SPI + X11; native Wayland apps get element actions but not coordinate clicks.                                                                            |
| Accessibility tree with element ids         | **✅**                 | ❌                 | ❌                       | ✅          | ✅        | ✅                | ✅                        | Codex and the Anthropic demo are screenshot-driven. Ids let the agent press _the button_ instead of a pixel.                                                                        |
| Background input (your mouse never moves)   | **✅**                 | ❌                 | n/a                      | ❌          | ❌        | ❌                | ❌                        | Munim Computer Use addresses events to the target window (SkyLight on macOS, posted window messages on Windows, XTEST on Linux). Every other desktop server drives the real cursor. |
| Agent pointer overlay                       | **✅**                 | ✅                 | ❌                       | ⚠️          | ❌        | ❌                | ❌                        | Windows-MCP flashes a border around captures; Codex draws its own cursor on your screen.                                                                                            |
| Zoom into a region at full resolution       | **✅**                 | ❌                 | ✅                       | ❌          | ❌        | ❌                | ❌                        | Anthropic's toolset has `zoom`; here it is a tool on every platform.                                                                                                                |
| Screenshots carry screen-coordinate mapping | **✅**                 | n/a                | n/a                      | ❌          | ❌        | ❌                | ❌                        | Origin and pixels-per-point in every capture, so clicks from Retina or downscaled images land.                                                                                      |
| Hover, wait, label query                    | **✅**                 | ⚠️                 | ⚠️                       | ✅          | ⚠️        | ❌                | ⚠️                        | Windows-MCP has Wait/WaitFor; MacOS-MCP has Wait; Anthropic has `wait`/`mouse_move`.                                                                                                |
| Your signed-in Chrome, own tab group        | **✅**                 | ⚠️                 | ❌                       | ⚠️          | ❌        | ❌                | ❌                        | Codex uses its in-app browser; Windows-MCP reads the DOM of open browsers. Munim Computer Use opens its own labelled tab group in your real Chrome and never touches your tabs.     |
| Works with any MCP client                   | **✅**                 | ❌                 | ❌                       | ✅          | ✅        | ✅                | ✅                        | Codex Computer Use is Codex only; the Anthropic demo is Claude only.                                                                                                                |
| Identical tool surface on every platform    | **✅**                 | n/a                | n/a                      | n/a         | n/a       | ⚠️                | ✅                        | 26 tools with byte-identical schemas across the Swift and Rust servers.                                                                                                             |
| Prebuilt signed binaries + npm launcher     | **✅**                 | ✅                 | ❌                       | ❌          | ❌        | ✅ (npm)          | ✅ (npm)                  | macOS universal (Developer ID signed) and Windows x64 on Releases.                                                                                                                  |
| Open source                                 | **✅ Apache-2.0**      | ❌                 | ✅                       | ✅ MIT      | ✅ MIT    | ✅ MIT            | ✅ MIT                    |                                                                                                                                                                                     |

Also looked at: [mediar-ai/mcp-server-macos-use](https://github.com/mediar-ai/mcp-server-macos-use) (macOS, accessibility, real input), [deploymenttheory/windows-mcp-server](https://github.com/deploymenttheory/windows-mcp-server) (Windows, UIA Invoke patterns, WaitFor), [nuphus-mcp](https://github.com/mrpulor-gh/nuphus-mcp) (OCR + bring-your-own vision model, CDP Chrome), [computer-control-mcp](https://github.com/AB498/computer-control-mcp) (PyAutoGUI + OCR), and [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) (browser only). Corrections welcome — open an issue with a link.

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

Designed and built by [Munim Technologies](https://munimtech.com) (Munim, Inc.) for MT Code. Copyright 2026 Munim, Inc. Licensed under the Apache License 2.0; see `LICENSE`.

Comparison sources: [Codex Computer Use](https://openai.com/index/codex-for-almost-everything/) · [Anthropic computer-use demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo) · [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) · [CursorTouch/MacOS-MCP](https://github.com/CursorTouch/MacOS-MCP) · [QwenLM/open-computer-use](https://github.com/QwenLM/open-computer-use) · [zavora-ai/computer-use-mcp](https://github.com/zavora-ai/computer-use-mcp) · [mediar-ai/mcp-server-macos-use](https://github.com/mediar-ai/mcp-server-macos-use) · [deploymenttheory/windows-mcp-server](https://github.com/deploymenttheory/windows-mcp-server) · [nuphus-mcp](https://github.com/mrpulor-gh/nuphus-mcp) · [computer-control-mcp](https://github.com/AB498/computer-control-mcp) · [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
