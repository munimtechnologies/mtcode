# Thread Deep Links

On macOS and Linux, the desktop app registers its own URL scheme, so other tools can link straight to a thread. The scheme follows the product you installed: `mtcode://` for MT Code, `t3code://` for T3 Code. Both can be installed side by side; each only answers to its own links.

```
mtcode://threads/<environmentId>/<threadId>
```

Opening a link takes you to that thread and focuses its window once the app is ready. If you are on a setup, pairing, or connection screen, the newest link waits until you return to the app. If you are already looking at the thread, nothing changes.

The `mtcode://app/<environmentId>/<threadId>` form is also accepted. The environment id must be a UUID — aliases like `primary` are not accepted. A link that does not match the format exactly does not navigate. The operating system may still launch the desktop app before the link is checked.

This is handy for anything that records which thread produced a result: a notification, a log line, or a message can carry a link that drops you back into the conversation.
