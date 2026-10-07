# Product usage data

The T3 Code server sends product usage events to PostHog, associated with a hashed account or
installation identifier. Events include the provider, model, reasoning effort, permission mode,
turn result, duration, and main-agent token totals when available.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

To disable collection, set `T3CODE_TELEMETRY_ENABLED=false` in the server's environment before
starting it. This stops product events from being recorded or sent.

The desktop app reads the variable from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

## MT Code update check

The desktop app checks `updates.mtcode.munimtech.com` for a new version every few minutes. That
check is also how MT Code counts downloads and daily active users.

To count people rather than devices, each check carries a short code for every Claude or ChatGPT
account the app finds signed in on that machine. The code is a one-way hash of the provider's
opaque account ID and the date, made on your machine. No email, name, token, or GitHub account
leaves it, and the code cannot be turned back into the account. Devices on the same account send
the same code, so they count as one user. The code changes every day, so no day can be linked to
another. The update server keeps each code for two days, then deletes it.
