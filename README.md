# MT Code

MT Code is a free, open-source desktop app for running and controlling coding agents — Claude Code, Codex, Cursor, Grok Build, and OpenCode — from one place. It is [Munim Technologies](https://munimtech.com)' fork of [T3 Code](https://github.com/pingdotgg/t3code) with extra features and fixes, and anyone can download and use it.

## Download

**[munimtech.com/mt-code](https://munimtech.com/mt-code)** — or grab installers straight from [GitHub Releases](https://github.com/sheehanmunim/mtcode/releases):

- **macOS** (Apple Silicon): `MT-Code-<version>-arm64.dmg`
- **Windows** (x64): `MT-Code-<version>-x64.exe`

Builds are currently unsigned:

- macOS: if Gatekeeper warns, right-click the app → **Open** (first launch only).
- Windows: if SmartScreen warns, choose **More info → Run anyway**.

The app auto-updates from this repository, so you get new MT Code features and fixes as they ship.

## Before you start

MT Code drives agents you already have. Install and sign in to at least one provider CLI:

- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude`
- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

Your existing subscriptions are used directly — MT Code sells nothing and adds no accounts of its own.

## What MT Code adds over T3 Code

- **Resume on restart** — threads and agents that were running when the app closed automatically pick up where they left off at the next launch.
- **Cross-thread references** — type `#` in the composer to reference another thread; the agent can read that thread's transcript.
- **Thread-to-thread messaging** — agents can list sibling threads and send messages between them, so parallel work can coordinate.
- **Agent-chosen computers** — agents can send a task to another machine already connected in MT Code (this computer, SSH, T3 Connect, or a paired backend) without you changing **Run on**.
- **Better "Open in editor" on macOS** — detects Cursor, VS Code Insiders, VSCodium, Trae, Kiro, and JetBrains IDEs by their app bundles, even when their CLI shims aren't installed.
- **Installs alongside official T3 Code** — its own bundle ID (`com.munim.t3code`) and its own isolated data directory, so it never touches the official app's settings or sessions.

Everything upstream T3 Code does — multi-provider agent control, checkpoints and diffs, remote access from the [web](https://app.t3.codes) and [mobile apps](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), Connect tunnels — works here too.

## Documentation

Full docs live in [docs/](./docs):

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Desktop notifications](./docs/user/desktop-notifications.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Thread messaging](./docs/user/thread-messaging.md)
- [Sending work to another computer](./docs/user/computer-routing.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Relationship to upstream

MT Code tracks [pingdotgg/t3code](https://github.com/pingdotgg/t3code) nightlies and regularly merges upstream. Features built here are offered upstream as PRs when they fit; some MT Code features started as unmerged upstream PRs we adopted. Bug reports about MT Code builds belong on [this repo's issues](https://github.com/sheehanmunim/mtcode/issues) — please don't file MT Code problems upstream.

MT Code exists because T3 Code is truly open. Credit and thanks to the T3 team.
