# Computer Use

An open-source [MCP](https://modelcontextprotocol.io) server that lets any coding agent use your computer the way a person does — read what is on screen, click, type, scroll, hover, drag, zoom in on small text, and drive Chrome tabs in your signed-in browser — on **macOS, Windows and Linux**.

It is the Computer Use engine inside [MT Code](https://munimtech.com/mt-code) (a fork of [T3 Code](https://github.com/pingdotgg/t3code)), published here on its own so it works with **Claude Code, Codex, Cursor, MT Code, or any other MCP client**. This repository is a mirror of `native/` in [munimtechnologies/mtcode](https://github.com/munimtechnologies/mtcode); changes land there first.

## Why this one

- **Accessibility first, pixels second.** `get_app_state` returns the app's accessibility tree with stable element ids, so an agent presses _the button_ instead of guessing at a coordinate. Screenshots are for verification and for content the tree cannot describe. This is the approach that scores highest on OSWorld-style tasks and it costs a fraction of the tokens.
- **Background control.** Clicks, typing and scrolling are delivered to the target window without moving your mouse or stealing focus (SkyLight window-addressed events on macOS, posted window messages on Windows, XTEST on Linux). You keep working while the agent works.
- **Pointer overlay, not your pointer.** A soft lavender agent pointer shows where the agent is acting. Your cursor is untouched.
- **Coordinate mapping that is actually correct.** Every screenshot and zoom carries its screen origin and pixels-per-point, so coordinates read off a Retina or downscaled image land where the agent meant. `zoom` captures a region at full physical resolution for small text.
- **Your browser, your logins.** The Chrome extension gives the agent its own labelled tab group in your signed-in Chrome. It never touches your tabs.
- **Model-agnostic.** No vision model is required for interaction; any MCP-capable model works, including local ones.

## Tools (26)

| Area                       | Tools                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| See                        | `list_apps`, `get_app_state` (with `query` filter), `screenshot`, `zoom`, `list_displays`                                                                                                                  |
| Act                        | `click`, `right_click`, `hover`, `drag`, `scroll`, `type_text`, `set_value`, `select_text`, `press_key`, `activate_app`, `wait`                                                                            |
| Browser (Chrome extension) | `browser_open_tab`, `browser_list_tabs`, `browser_select_tab`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press_key`, `browser_close_tab`, `browser_close_all_tabs` |

The tool names, argument shapes and descriptions are identical on every platform, so a model that learned them on a Mac needs nothing new on Windows.

## Install

### macOS (Swift)

```sh
cd t3-desktop-mcp
swift build -c release
# binary: .build/release/t3-desktop-mcp
.build/release/t3-desktop-mcp request-permissions   # prompts for Accessibility + Screen Recording
```

Requires macOS 14+.

### Windows and Linux (Rust)

```sh
cd t3-desktop-mcp-rs
cargo build --release
# binary: target/release/t3-desktop-mcp(.exe)
```

Windows uses UI Automation; Linux uses AT-SPI with X11/XTEST input (Wayland: element actions work, coordinate clicks need an X11/XWayland client).

### Register it with your agent

The server speaks MCP over stdio. Point your client at the binary:

**Claude Code**

```sh
claude mcp add computer-use -- /absolute/path/to/t3-desktop-mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.computer-use]
command = "/absolute/path/to/t3-desktop-mcp"
```

**Cursor** (`.cursor/mcp.json`)

```json
{ "mcpServers": { "computer-use": { "command": "/absolute/path/to/t3-desktop-mcp" } } }
```

MT Code ships this server built in (as `mt-desktop`) and attaches it to every thread automatically.

### Chrome extension (optional)

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `t3-chrome-extension/`.
2. Register the native messaging host so Chrome can reach the server: `sh t3-chrome-extension/install.sh` (macOS/Linux) or `powershell -File t3-chrome-extension/install.ps1` (Windows).

Agent tabs open in their own tab group with the agent pointer as favicon; `browser_close_all_tabs` (or the end of the session) removes the group.

## Environment flags

| Variable                                 | Effect                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| `T3_DESKTOP_BROWSER=0`                   | Hide the `browser_*` tools                                      |
| `T3_DESKTOP_AGENT_CURSOR=0`              | Do not draw the agent pointer                                   |
| `T3_DESKTOP_AGENT_CURSOR_TASK_FADE_SECS` | How long the pointer stays after the last tool call (default 8) |
| `T3_DESKTOP_ALLOW_SECURE_FIELD_INPUT=1`  | Allow typing into password fields (refused by default)          |
| `T3_DESKTOP_COMPUTER_USE_YIELD_SECS`     | Pause the agent when the user is actively using the machine     |

## How an agent should use it

Look → act → verify. `get_app_state` for ids, act by id, then `get_app_state` or `screenshot` again before the next step. Use `zoom` for small text, `hover` for menus that appear on mouse-over, `wait` after loads, keyboard shortcuts for stubborn widgets. The instructions MT Code gives its agents are in `apps/server/src/provider/CodexDeveloperInstructions.ts` upstream and make a good system-prompt starting point.

## Credits and license

Built on the Computer Use work in [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc. and extended in MT Code by Munim Technologies. MIT licensed; see `LICENSE`.
