# Terminal history

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

# Find in the terminal

With a terminal focused, press `mod+f` to search its output and scrollback.
`mod` is Command on macOS and Ctrl on Windows and Linux; `Ctrl+Shift+F` also
works. Enter moves to the next match and Shift+Enter to the previous one. Use
the toggle for case-sensitive search, and Escape to close. The find bar can be
dragged by its grip handle between the top-right and bottom-right corners of the
terminal and remembers your preference. Rebind **Terminal: Find** in Settings →
Keybindings.
