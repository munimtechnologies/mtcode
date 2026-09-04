# MT Code

MT Code is a free, open-source desktop app for running and controlling coding agents — Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity — from one place. It is [Munim Technologies](https://munimtech.com)' fork of [T3 Code](https://github.com/pingdotgg/t3code) with extra features and fixes, and anyone can download and use it.

## Download

**[munimtech.com/mt-code](https://munimtech.com/mt-code)** — or grab installers straight from [GitHub Releases](https://github.com/munimtechnologies/mtcode/releases):

- **macOS** (Apple Silicon): `MT-Code-<version>-arm64.dmg`
- **Windows** (x64): `MT-Code-<version>-x64.exe`

macOS builds are signed with a Developer ID but not yet notarized; Windows builds are unsigned:

- macOS: if Gatekeeper warns, right-click the app → **Open** (first launch only).
- Windows: if SmartScreen warns, choose **More info → Run anyway**.

The app auto-updates from this repository, so you get new MT Code features and fixes as they ship.

### Use it in the browser

[mtcode.munimtech.com](https://mtcode.munimtech.com) hosts the MT Code web app. Run the desktop app (or `npx t3@latest`) on your machine, generate a pairing link from Settings → Connections, and control your agents from any browser — including your phone. The backend must be reachable over HTTPS (Tailscale Serve or a tunnel work well); see [remote access](./docs/user/remote-access.md).

## Before you start

MT Code drives agents you already have. Install and sign in to at least one provider CLI:

- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude`
- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

Your existing subscriptions are used directly — MT Code sells nothing and adds no accounts of its own.

Same cost model as T3 Code: the app and its server run on your computer, and model tokens come from Claude / Codex / Cursor / Grok / OpenCode. The hosted UI at [mtcode.munimtech.com](https://mtcode.munimtech.com) is a static Worker on Cloudflare’s free plan. Pairing and Computer Use reach your machine directly. There is no Munim-hosted model proxy, no Workers AI classifier, and no PlanetScale relay unless you explicitly opt into that paid stack.

## MT Code vs T3 Code

Compared to [T3 Code](https://github.com/pingdotgg/t3code). MT Code started as a fork. Upstream is merged only when you ask an agent to do it — nothing pulls `pingdotgg/t3code` automatically. Some rows started as unmerged upstream PRs that MT Code ships today; others were built here. 🚧 means it is in another MT Code thread/worktree and is not on the downloadable build yet.

| Feature                                                                                                                                                                               |                         MT Code                         |                 T3 Code                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----------------------------------------------------: | :-------------------------------------: |
| **Computer Use** — agents click, type, screenshot, and drive browser tabs on your desktop                                                                                             |                           ✅                            |                   ❌                    |
| **Computer History** — opt-in activity timeline (not screenshots) that agents can reference                                                                                           |                           ✅                            |                   ❌                    |
| **Agent-chosen computers** — `computer_list` / `computer_send` start a task on another connected machine (this Mac, SSH, T3 Connect, or a paired backend) without changing **Run on** |                           ✅                            |                   ❌                    |
| **Resume on restart** — running threads and agents pick up after the app closes                                                                                                       |                           ✅                            |                   ❌                    |
| **Cross-thread references** — type `#` to cite another thread; the agent can read it                                                                                                  |                           ✅                            |                   ❌                    |
| **Thread-to-thread messaging** — agents list sibling threads and send work between them                                                                                               |                           ✅                            |                   ❌                    |
| **Agent-created threads** — `thread_create` / `thread_archive` so an agent can spawn and tidy sibling chats in the same project                                                       |                           ✅                            |                   ❌                    |
| **Drag to reorder active threads** — same fractional-key order as pins, synced across clients                                                                                         |                           ✅                            |                   ❌                    |
| **Sign in extra Claude/Codex accounts** from Settings without leaving the app                                                                                                         |                           ✅                            |                   ❌                    |
| **Provider handoff** — continue a thread with another provider or account from the model picker; native history when possible, otherwise a bounded handoff of recent work             |                           ✅                            |                   ❌                    |
| **Forgejo** as a git host alongside GitHub/GitLab/Bitbucket                                                                                                                           |                           ✅                            |                   ❌                    |
| **Cursor on by default** with real permission-option mapping                                                                                                                          |                           ✅                            |                   ❌                    |
| **Goals** — `/goal` keeps a thread working until the objective is met                                                                                                                 |                           ✅                            |                   ❌                    |
| **Plugin marketplace** — browse and install Codex, Claude Code, and Cursor plugins                                                                                                    |                           ✅                            |                   ❌                    |
| **Skills manager** — cross-harness skills in Settings                                                                                                                                 |                           ✅                            |                   ❌                    |
| **Voice dictation** — Codex-style mic in the composer (OpenAI or Groq)                                                                                                                |                           ✅                            |                   ❌                    |
| **Realtime voice** — persistent OpenAI Realtime panel so you can talk with the agent, not only dictate                                                                                |                           ✅                            |                   ❌                    |
| **Agent notifications** — desktop/browser alerts for approvals, questions, finish, and failure                                                                                        |                           ✅                            |                   ❌                    |
| **PDF attachments** — paste or drop PDFs in chat (Claude, Cursor, Grok, OpenCode)                                                                                                     |                           ✅                            |                   ❌                    |
| **Stacked pull requests** — GitHub PR stacks in the source-control UI                                                                                                                 |                           ✅                            |                   ❌                    |
| **Browser cookie import** — pull cookies from Chrome, Edge, Brave, Safari, Firefox, and others into a preview profile                                                                 |                           ✅                            |                   ❌                    |
| **Full-text sidebar search** — search message content, not just titles                                                                                                                |                           ✅                            |                   ❌                    |
| **Sort threads by last user message**                                                                                                                                                 |                           ✅                            |                   ❌                    |
| **Recent-threads switcher** — Ctrl/Cmd+Tab                                                                                                                                            |                           ✅                            |                   ❌                    |
| **Live tool activity grouping**                                                                                                                                                       |                           ✅                            |                   ❌                    |
| **Composer state drawers**                                                                                                                                                            |                           ✅                            |                   ❌                    |
| **LaTeX math** in chat                                                                                                                                                                |                           ✅                            |                   ❌                    |
| **Codex visualizations** rendered inline                                                                                                                                              |                           ✅                            |                   ❌                    |
| **Reasoning cycle keybindings**                                                                                                                                                       |                           ✅                            |                   ❌                    |
| **Grok reasoning-effort picker**                                                                                                                                                      |                           ✅                            |                   ❌                    |
| **OpenCode context-window usage**                                                                                                                                                     |                           ✅                            |                   ❌                    |
| **Cursor account limits** — Auto / API / monthly spend on the Limits strip                                                                                                            |                           ✅                            |                   ❌                    |
| **Rename environments**                                                                                                                                                               |                           ✅                            |                   ❌                    |
| **Preview viewport + mute browser tab**                                                                                                                                               |                           ✅                            |                   ❌                    |
| **Reveal chat file chips** in Finder / Explorer                                                                                                                                       |                           ✅                            |                   ❌                    |
| **`t3 .` opens a folder** in the desktop app or a running server                                                                                                                      |                           ✅                            |                   ❌                    |
| **Better Open in editor on macOS** — finds Cursor, VS Code Insiders, VSCodium, Trae, Kiro, Zed, and JetBrains by app bundle, even without CLI shims                                   |                           ✅                            |                   ❌                    |
| **Installs alongside T3 Code** — own bundle ID (`com.munim.mtcode`) and data directory (`~/.mt`)                                                                                      |                           ✅                            |                   ❌                    |
| **Hosted web app**                                                                                                                                                                    | ✅ [mtcode.munimtech.com](https://mtcode.munimtech.com) | ✅ [app.t3.codes](https://app.t3.codes) |

Everything else T3 Code does — multi-provider agent control, checkpoints and diffs, remote access from the [web](https://app.t3.codes) and [mobile apps](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), Connect tunnels — works here too.

## Documentation

Full docs live in [docs/](./docs):

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Desktop notifications](./docs/user/desktop-notifications.md)
- [Goals](./docs/user/goals.md)
- [Plugins](./docs/user/plugins.md)
- [Voice dictation](./docs/user/voice-dictation.md)
- [Attachments](./docs/user/attachments.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Thread messaging](./docs/user/thread-messaging.md)
- [Continue a thread with another provider](./docs/user/provider-handoff.md)
- [Sending work to another computer](./docs/user/computer-routing.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Relationship to upstream

MT Code does not auto-merge [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Upstream lands only when you explicitly ask an agent to merge it. Features built here are offered upstream as PRs when they fit; some MT Code features started as unmerged upstream PRs we adopted. Bug reports about MT Code builds belong on [this repo's issues](https://github.com/munimtechnologies/mtcode/issues) — please don't file MT Code problems upstream.

MT Code exists because T3 Code is truly open. Credit and thanks to the T3 team.
