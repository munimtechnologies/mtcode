# MT Code update feed

A Cloudflare Worker at `updates.mtcode.munimtech.com` that sits between the desktop
updater and GitHub Releases, so updates can be counted.

## Why it exists

GitHub publishes one cumulative download counter per release asset, and it only
moves for a full-file request. A `Range:` request returns `206` and leaves it
alone — verified directly against a release asset. electron-updater takes
exactly that path: it fetches the `.blockmap`, then range-requests the archive,
whenever a blockmap is published, which is every release here. So publishing
straight at the repo made **every differential auto-update invisible**, and the
README badge could only ever report full downloads.

It also reported the wrong thing entirely until recently: summing every asset
counted the update feed, and one always-on install fetches `latest-mac.yml`
every four minutes. 7396 of the first 7430 "downloads" were feed polls and
blockmap reads.

## What it does

The Worker owns no artifacts. GitHub Releases stays the only place a release
lives.

| Route                                                | Behaviour                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `/latest-mac.yml`, `/latest.yml`, `/nightly*.yml`    | Proxied from the newest GitHub release, cached 60s. Records a poll. |
| `/MT-Code-<version>-<arch>.<ext>` (also `.blockmap`) | Records a delivery, then `302`s to that version's GitHub asset.     |
| `/stats`                                             | `{ deliveries, deliveriesLast30Days, activeInstalls }`              |

Redirecting rather than streaming keeps ~150 MB of release payload off the
Worker while still putting every request through the counter — the updater
already follows GitHub's own redirect to object storage.

Anything the Worker cannot serve falls through to a `302` at the same GitHub URL
the app used before this existed. A broken Worker must not mean a fleet that
cannot update.

## Counting

D1, one row per `(day, kind, client, version)`. The primary key does the
de-duplication: a differential update that issues forty range requests is one
delivery, and a client polling every four minutes is one poll per day.

`client` is a truncated SHA-256 of a secret salt, the IP and the user agent. No
address is stored, and the value is meaningless without `CLIENT_SALT`.

## How the app finds it

`T3CODE_DESKTOP_UPDATE_URL` makes `resolveGitHubPublishConfig` emit a `generic`
publish provider instead of `github`; `scripts/personal-publish-github-release.sh`
sets it, and passes it to the Windows build host. `useMultipleRangeRequest` must
stay `false`: the bytes come from GitHub's release storage, which answers a
multi-range request with **501**, and the generic provider enables multi-range by
default.

Builds without that variable still publish straight at GitHub, so a plain
`pnpm dist:desktop:*` needs no extra service.

## Migration

A client reads exactly one feed, so the two populations never overlap: installs
built before the switch keep polling GitHub and are counted there, everything
built after is counted here. `.github/workflows/download-counts.yml` sums both,
and drops the `~` from the Active Installs badge once the GitHub-side estimate
reaches zero.

## Operating

```bash
wrangler deploy                                   # ship
wrangler d1 migrations apply mtcode-updates --remote
wrangler tail mtcode-updates                      # live logs
wrangler d1 execute mtcode-updates --remote \
  --command "SELECT day, kind, COUNT(*) FROM events GROUP BY day, kind ORDER BY day DESC LIMIT 20"
```
