<!-- Banner Image -->

<p align="center">
  <a href="https://github.com/munimtechnologies/mtcode">
    <img alt="Munim Technologies" height="128" src="./.github/resources/banner.png">
    <h1 align="center">MT Code</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Latest release" href="https://github.com/munimtechnologies/mtcode/releases/latest" target="_blank">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/munimtechnologies/mtcode?filter=munim-v*&style=flat-square&label=Version&labelColor=000000&color=0066CC" />
  </a>
  <a aria-label="App is free to use" href="https://github.com/munimtechnologies/mtcode/blob/main/LICENSE" target="_blank">
    <img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache%202.0-success.svg?style=flat-square&color=33CC12" />
  </a>
  <a aria-label="total downloads" href="https://github.com/munimtechnologies/mtcode/releases" target="_blank">
    <img alt="Total Downloads" src="https://img.shields.io/github/downloads/munimtechnologies/mtcode/total?style=flat-square&labelColor=gray&color=0066CC&label=Total%20Downloads" />
  </a>
</p>

<p align="center">
  <a aria-label="download" href="https://munimtech.com/mt-code"><b>Download MT Code</b></a>
&ensp;•&ensp;
  <a aria-label="documentation" href="https://github.com/munimtechnologies/mtcode/tree/main/docs">Read the Documentation</a>
&ensp;•&ensp;
  <a aria-label="report issues" href="https://github.com/munimtechnologies/mtcode/issues">Report Issues</a>
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

MT Code is a free, open-source desktop app for running and controlling coding agents — Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity — from one place. It is [Munim Technologies](https://munimtech.com)' fork of [T3 Code](https://github.com/pingdotgg/t3code) with extra features and fixes, and anyone can download and use it.

## Download

**[munimtech.com/mt-code](https://munimtech.com/mt-code)** — or grab installers straight from [GitHub Releases](https://github.com/munimtechnologies/mtcode/releases):

- **macOS** (Apple Silicon): `MT-Code-<version>-arm64.dmg`
- **Windows** (x64): `MT-Code-<version>-x64.exe`

macOS builds are signed with a Developer ID but not yet notarized; Windows builds are unsigned:

- macOS: if Gatekeeper warns, right-click the app → **Open** (first launch only).
- Windows: if SmartScreen warns, choose **More info → Run anyway**.

The app auto-updates from this repository, so you get new MT Code features and fixes as they ship.

### Use it from a browser or phone

MT Code has no hosted web app of its own. Run the desktop app (or `npx t3@latest`) on your machine and reach it from another device over T3 Connect or your own HTTPS tunnel (Tailscale Serve works well); see [remote access](./docs/user/remote-access.md).

## Before you start

MT Code drives agents you already have. Install and sign in to at least one provider CLI:

- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude`
- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

Your existing subscriptions are used directly — MT Code sells nothing and adds no accounts of its own.

Same cost model as T3 Code: the app and its server run on your computer, and model tokens come from Claude / Codex / Cursor / Grok / OpenCode. Munim hosts nothing on your behalf — pairing and Computer Use reach your machine directly. There is no Munim-hosted web app, no model proxy, no Workers AI classifier, and no PlanetScale relay unless you explicitly opt into that paid stack.

## MT Code vs T3 Code

Compared to [T3 Code](https://github.com/pingdotgg/t3code). MT Code started as a fork. Upstream is merged only when you ask an agent to do it — nothing pulls `pingdotgg/t3code` automatically. Some rows started as unmerged upstream PRs that MT Code ships today; others were built here.

This table lists only the differences. Once T3 Code ships a feature MT Code had first, MT Code adopts T3 Code's implementation and the row leaves the table — drag-to-reorder, PDF attachments, cookie import, tool-activity grouping, composer drawers, preview viewport, file-chip reveal, macOS editor discovery, pull request stacks, Cursor / Grok / OpenCode Go limits, and full-text sidebar search all went that way. Nothing T3 Code ships is missing here.

| Feature                                                                                                                                                                                                       | MT Code |                 T3 Code                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----: | :-------------------------------------: |
| **Computer Use** — agents click, type, screenshot, zoom, hover, and drive browser tabs on your desktop; powered by open-source [munim-computer-use](https://github.com/munimtechnologies/munim-computer-use) |   ✅    |                   ❌                    |
| **Computer History** — opt-in activity timeline (not screenshots) that agents can reference                                                                                                                   |   ✅    |                   ❌                    |
| **Agent-chosen computers** — `computer_list` / `computer_send` start a task on another connected machine (this Mac, SSH, T3 Connect, or a paired backend) without changing **Run on**                         |   ✅    |                   ❌                    |
| **Resume on restart** — running threads and agents pick up after the app closes                                                                                                                               |   ✅    |                   ❌                    |
| **Cross-thread references** — type `#` to cite another thread; the agent can read it                                                                                                                          |   ✅    |                   ❌                    |
| **Thread-to-thread messaging** — agents list sibling threads and send work between them                                                                                                                       |   ✅    |                   ❌                    |
| **Agent-created threads** — `thread_create` / `thread_archive` so an agent can spawn and tidy sibling chats in the same project                                                                               |   ✅    |                   ❌                    |
| **Sign in extra Claude/Codex accounts** from Settings without leaving the app                                                                                                                                 |   ✅    |                   ❌                    |
| **Provider handoff** — continue a thread with another provider or account from the model picker; native history when possible, otherwise a bounded handoff of recent work                                     |   ✅    |                   ❌                    |
| **Forgejo** as a git host alongside GitHub/GitLab/Bitbucket                                                                                                                                                   |   ✅    |                   ❌                    |
| **Cursor on by default** with real permission-option mapping                                                                                                                                                  |   ✅    |                   ❌                    |
| **Goals** — `/goal` keeps a thread working until the objective is met                                                                                                                                         |   ✅    |                   ❌                    |
| **Plugin marketplace** — browse, install, and manage Codex, Claude Code, and Cursor plugins in per-harness tabs with an Installed section                                                                     |   ✅    |                   ❌                    |
| **Skills manager** — cross-harness skills in Settings                                                                                                                                                         |   ✅    |                   ❌                    |
| **Voice dictation** — Codex-style mic in the composer (OpenAI or Groq)                                                                                                                                        |   ✅    |                   ❌                    |
| **Realtime voice** — persistent OpenAI Realtime panel so you can talk with the agent, not only dictate                                                                                                        |   ✅    |                   ❌                    |
| **Agent notifications** — desktop/browser alerts for approvals, questions, finish, and failure                                                                                                                |   ✅    |                   ❌                    |
| **Sort threads by last user message**                                                                                                                                                                         |   ✅    |                   ❌                    |
| **Recent-threads switcher** — Ctrl+Tab in the desktop app (browsers reserve Ctrl+Tab; rebind in Settings → Keybindings)                                                                                       |   ✅    |                   ❌                    |
| **LaTeX math** in chat                                                                                                                                                                                        |   ✅    |                   ❌                    |
| **Codex visualizations** rendered inline                                                                                                                                                                      |   ✅    |                   ❌                    |
| **Reasoning cycle keybindings**                                                                                                                                                                               |   ✅    |                   ❌                    |
| **Grok reasoning-effort picker**                                                                                                                                                                              |   ✅    |                   ❌                    |
| **OpenCode context-window usage**                                                                                                                                                                             |   ✅    |                   ❌                    |
| **OpenCode connected subscription limits** — saved ChatGPT and Claude account windows alongside upstream’s OpenCode Go limits                                                                                 |   ✅    |                   ❌                    |
| **Rename environments**                                                                                                                                                                                       |   ✅    |                   ❌                    |
| **`t3 .` opens a folder** in the desktop app or a running server                                                                                                                                              |   ✅    |                   ❌                    |
| **Installs alongside T3 Code** — own bundle ID (`com.munim.mtcode`) and data directory (`~/.mt`)                                                                                                              |   ✅    |                   ❌                    |
| **Usage-limit recovery** — a thread stopped by a subscription limit shows _Limited_, can snooze until the reset, and can auto-resume                                                                          |   ✅    |                   ❌                    |
| **Monitor toolkit** — `monitor_start` lets an agent end its turn and be woken by background command output                                                                                                    |   ✅    |                   ❌                    |
| **Per-thread auto-settle switch**, pinned threads exempt from settling, and an option to settle only threads without a PR                                                                                     |   ✅    |                   ❌                    |
| **Read state synced across clients** — Done indicators clear on every machine                                                                                                                                 |   ✅    |                   ❌                    |
| **Agent thread tools** — `t3_worktree_handoff`, `t3_thread_update` (rename / retitle), agent history reads, `preview_open` browser profiles                                                                   |   ✅    |                   ❌                    |
| **One-tap Continue** for interrupted turns, and per-provider permission defaults                                                                                                                              |   ✅    |                   ❌                    |
| **Multi-machine projects** — copy a checkout to another machine, per-server directory and worktree defaults, branch prefix, `.worktreeinclude`, SSH agent forwarding                                          |   ✅    |                   ❌                    |
| **Desktop extras** — thread deep links (`mtcode://`), external terminal apps, login-shell env allowlist, Windows tray with persist-on-close                                                                   |   ✅    |                   ❌                    |
| **Find in chat and terminal** (Cmd/Ctrl+F), Mermaid diagrams, editable queued messages                                                                                                                        |   ✅    |                   ❌                    |
| **More providers** — Devin (ACP), native Pi, Claude advisor model, native slash commands for OpenCode / Cursor / Grok                                                                                         |   ✅    |                   ❌                    |
| **Conversation import and forking** — import Claude Code / Codex history, fork a conversation into a new thread, self-hosted Android push                                                                     |   ✅    |                   ❌                    |
| **Scheduled sends** — queue a message for a later time, with recurrence                                                                                                                                       |   ✅    |                   ❌                    |
| **Script threads from the CLI** — `t3 thread start` and `t3 thread send`                                                                                                                                      |   ✅    |                   ❌                    |
| **Custom thread title instructions**, and drag to reorder or hide provider models                                                                                                                             |   ✅    |                   ❌                    |
| **Hosted web app** — MT Code's own was retired; use T3 Connect or your own tunnel instead                                                                                                                     |   ❌    | ✅ [app.t3.codes](https://app.t3.codes) |

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
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Thread messaging](./docs/user/thread-messaging.md)
- [Continue a thread with another provider](./docs/user/provider-handoff.md)
- [Sending work to another computer](./docs/user/computer-routing.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Relationship to upstream

MT Code does not auto-merge [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Upstream lands only when you explicitly ask an agent to merge it. Features built here are offered upstream as PRs when they fit; some MT Code features started as unmerged upstream PRs we adopted. Bug reports about MT Code builds belong on [this repo's issues](https://github.com/munimtechnologies/mtcode/issues) — please don't file MT Code problems upstream.

MT Code exists because T3 Code is truly open. Credit and thanks to the T3 team.
