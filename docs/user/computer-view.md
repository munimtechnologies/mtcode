# Viewing a thread's computer

When a thread runs on a machine that supports Computer Use, the chat header shows a monitor
button. It opens a live view of that computer's screen, like a lightweight remote desktop, and
`mod+alt+v` toggles it from the keyboard.

While the view is open:

- The screen refreshes a few times per second. Multi-display machines get a display picker in the
  view's header.
- Control is on by default: clicks, double-clicks, right-clicks, drags, scrolling, and typing are
  forwarded to the remote machine. The pointer toggle switches to view-only, where only `Esc`
  (close) is handled locally.
- While controlling, keys go to the remote machine; use the toggle button or `mod+alt+v` to close.

The button only appears for computers that ship the desktop control helper, and the remote machine
must have Computer Use enabled in its Settings. On macOS the helper also needs the Screen
Recording permission. Everything travels over the same connection as the rest of the thread, so
remote and tunneled environments work unchanged.
