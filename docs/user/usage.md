# Review usage

The Usage page combines Claude Code, Codex, Cursor, Grok, and OpenCode activity
from your connected environments. It shows API-equivalent token cost, processed
tokens, cache savings, provider shares, and model breakdowns. Subscription
billing is separate from the raw token cost shown here. If the model rate table
cannot be loaded, the page says cost is unavailable instead of $0.00. Token
counts are still valid.

| Provider    | Source                                                                                |
| ----------- | ------------------------------------------------------------------------------------- |
| Claude Code | Local Claude session transcripts under the Claude home                                |
| Codex       | Local Codex session transcripts under the Codex home                                  |
| Grok        | Local Grok Build session transcripts under the Grok home                              |
| Cursor      | Cursor dashboard usage export (requires Cursor desktop signed in on that environment) |
| OpenCode    | Local OpenCode SQLite databases under the OpenCode data directory                     |

Totals include work done outside T3 Code when the provider writes its own
session history (Claude, Codex, Grok, and OpenCode) or when Cursor reports
usage for the signed-in desktop account.

Prompt text, responses, and tool output are not sent to the client; environments
return only aggregated usage totals. When a provider records a cost, T3 Code uses
it. Otherwise, it estimates cost from the available model rate table and marks
models it cannot price.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period.
The **7 days**, **30 days**, and **90 days** ranges use daily resolution.
**All** scans local provider history from 2020-01-01 onward. Cost and token
toggles update both the headline and chart, and refreshing rescans every
connected environment.

Cost figures are API-equivalent estimates from provider-reported dollars when
present, otherwise from a shared model rate table. They are not subscription
charges. Cursor rows billed as included on the plan still contribute tokens and
are priced at API-equivalent rates: Cursor's published Auto Cost / Composer /
Grok rates for those product models, and the underlying model API rate for
third-party Cursor export names (effort and thinking suffixes stripped). Auto
Balance / Intelligence may differ from Auto Cost when Cursor routed to another
model — the export does not say which Auto mode ran.

When multiple connected environments point to the same provider data on one
machine, T3 Code counts that source once to avoid duplicate totals.

## Cursor coverage

Cursor agent transcripts on disk do not include token counts. T3 Code reads
usage from Cursor's own export when the environment machine has Cursor desktop
installed and signed in. That uses the desktop session on the machine running
the T3 Code server — the same host-trust model as scanning Claude or Codex
homes. Any client paired to that environment can see the resulting usage.
Environments without that desktop login show Cursor as uncovered and still
report Claude, Codex, Grok, and OpenCode normally.

## OpenCode coverage

For OpenCode, T3 Code honors `OPENCODE_DB` and discovers databases created by
channel installs in OpenCode's data directory. In-memory OpenCode databases
cannot be inspected by another process.

## Grok coverage

Grok Build writes session updates to `~/.grok/sessions/**/updates.jsonl`. Set
`GROK_HOME` to scan a non-default Grok home directory.
