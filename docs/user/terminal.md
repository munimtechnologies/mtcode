# Terminal

## External terminal apps

In the desktop app, choose **Settings → Integrations → Terminal app**, then open
the chat’s **Open** dropdown and select the action under **Terminal**. It opens
the current project or worktree directory in your selected app. Install that
terminal app on the machine running T3 Code desktop. Selecting Terminal or iTerm2
on macOS requests Automation permission before saving your choice. If you deny
access, enable it in **System Settings → Privacy & Security → Automation** and
select the terminal again.

For remote environments, the terminal connects over SSH and changes to that
directory. It uses your local SSH configuration and credentials; a T3 Code
connection alone does not grant SSH access. Environments without an advertised
SSH host or configured SSH alias cannot use this action.

## Choose a shell

Set `T3CODE_TERMINAL_SHELL` in the environment that launches the T3 Code server
to choose the executable used for new terminals. Use an executable name or its
full path, without surrounding quotes or command-line arguments. An unset or
blank value keeps the platform default. If the executable cannot be started,
T3 Code tries its usual fallback shells.

On Windows, to use Git Bash from a standard Git for Windows installation, run
this in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('T3CODE_TERMINAL_SHELL', 'C:\Program Files\Git\bin\bash.exe', 'User')
```

Fully quit T3 Code, then reopen it from the Start menu and create a new terminal.
If the app still inherits the old environment, sign out of Windows and sign in
again. Git Bash starts as an interactive login shell. Use `bin\bash.exe`, not
`git-bash.exe`, which launches a separate terminal window.

To restore the default, remove the variable with the same command using `$null`
as its second argument, then restart T3 Code.

This setting belongs to the machine hosting the server, including when you
connect from another device. It does not change provider-run commands or the
shell used by automatic project setup and settle scripts.

## Terminal history

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

On web and desktop, use Shift+PageUp and Shift+PageDown to read scrollback
without leaving terminal input. Ctrl+Shift+Home and Ctrl+Shift+End jump to the
start and latest output; use Cmd instead of Ctrl on macOS. Full-screen terminal
programs keep these navigation keys.

To copy all retained output, choose Select all in the terminal's context menu,
then copy. Cmd+A on macOS and Ctrl+Shift+A elsewhere select the same output.
Ctrl+A still moves to the beginning of shell input on Windows and Linux.
Jump to latest in the context menu returns to the current output.

On iPhone and iPad, long-press the terminal to paste or to choose Select Text.
Select Text shows the visible output, where you can copy text or tap a link.

## Find in the terminal

With a terminal focused, press `mod+f` to search its output and scrollback.
`mod` is Command on macOS and Ctrl on Windows and Linux; `Ctrl+Shift+F` also
works, or click the search icon next to the terminal buttons. Enter moves to
the next match and Shift+Enter to the previous one. Use the toggle for
case-sensitive search, and Escape to close. Rebind **Terminal: Find** in
Settings → Keybindings.

## fish

T3 Code starts fish with `no-query-term`, avoiding startup waits for terminal
replies. This disables optional fish features that depend on those replies.
T3 Code's exported `fish_features` also hides any universal flags you set with
`set -U fish_features`.

To preserve those flags or enable queries with `query-term`, include them in
`fish_features` in the environment that launches T3 Code. A shell export applies
when you launch T3 Code from that shell; it does not configure a desktop app
launched from the Dock or Finder. Enabling queries can restore the startup wait.
