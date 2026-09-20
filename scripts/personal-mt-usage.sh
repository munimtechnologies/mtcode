#!/usr/bin/env bash
# Estimate how many MT Code installs are actually running.
#
# There is no telemetry in this fork, so the only signal is GitHub's release
# asset download counts -- and those are dominated by electron-updater, which
# re-fetches the feed file (latest-mac.yml / latest.yml) off the newest release
# every AUTO_UPDATE_POLL_INTERVAL. A release that stays newest for three days
# collects ~1000 "downloads" from a single running app, so the raw totals say
# nothing about how many people have it.
#
# The poll *rate* does say something. Divide a release's feed fetches by the
# hours it was the newest release, and by the polls one running app makes per
# hour, and the quotient is roughly how many copies were running in that window.
#
# Installer downloads (.dmg/.exe/.zip) are counted separately: those are people
# installing by hand, cumulative since the release was published.
set -euo pipefail

REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
RELEASE_REPO="${T3_MUNIM_RELEASE_REPO:-munimtechnologies/mtcode}"
TAG_PREFIX="${T3_MUNIM_TAG_PREFIX:-munim-v}"

# Read the interval from the app rather than hardcoding it, so the estimate
# stays honest if the poll rate is ever retuned.
POLL_SOURCE="$REPO/apps/desktop/src/updates/DesktopUpdates.ts"
POLL_MINUTES=$(
  sed -n 's/.*AUTO_UPDATE_POLL_INTERVAL = "\([0-9][0-9]*\) *minute.*/\1/p' "$POLL_SOURCE" | head -1
)
if [[ -z "$POLL_MINUTES" ]]; then
  echo "could not read AUTO_UPDATE_POLL_INTERVAL from $POLL_SOURCE" >&2
  exit 1
fi

RELEASES_JSON=$(mktemp -t mt-usage)
trap 'rm -f "$RELEASES_JSON"' EXIT
gh api --paginate "repos/$RELEASE_REPO/releases?per_page=100" > "$RELEASES_JSON"

POLL_MINUTES="$POLL_MINUTES" TAG_PREFIX="$TAG_PREFIX" RELEASE_REPO="$RELEASE_REPO" \
  node --input-type=module -e '
import { readFileSync } from "node:fs";

const pollMinutes = Number(process.env.POLL_MINUTES);
const prefix = process.env.TAG_PREFIX;
const pollsPerHour = 60 / pollMinutes;

// published_at, not created_at: created_at is the tagged commits date, so two
// releases cut from one commit report the same instant and sort arbitrarily.
// What matters here is when each release became the one clients poll.
const publishedAt = (release) => Date.parse(release.published_at ?? release.created_at);

const releases = JSON.parse(readFileSync(process.argv[1], "utf8"))
  .filter((r) => r.tag_name.startsWith(prefix))
  .sort((a, b) => publishedAt(a) - publishedAt(b));

const rows = releases.map((release, index) => {
  const start = publishedAt(release);
  // Each release collects polls only while it is the newest one.
  const end = index + 1 < releases.length ? publishedAt(releases[index + 1]) : Date.now();
  const hours = (end - start) / 3_600_000;
  const by = new Map(release.assets.map((a) => [a.name, a.download_count]));
  const installers = release.assets
    .filter((a) => /\.(dmg|exe|zip)$/.test(a.name))
    .reduce((sum, a) => sum + a.download_count, 0);
  return {
    tag: release.tag_name.slice(prefix.length),
    hours,
    mac: by.get("latest-mac.yml") ?? 0,
    win: by.get("latest.yml") ?? 0,
    installers,
    hasMacFeed: by.has("latest-mac.yml"),
    hasWinFeed: by.has("latest.yml"),
  };
});

const estimate = (polls, hours) => (hours > 0 ? polls / (hours * pollsPerHour) : null);
const fmt = (n) => (n === null ? "  -  " : n.toFixed(2).padStart(5));

console.log(`\nMT Code running-install estimate -- ${process.env.RELEASE_REPO}`);
console.log(`updater polls every ${pollMinutes} min, so one running app = ${pollsPerHour} feed fetches/hour\n`);
console.log("  release        newest for   mac polls   ~macs   win polls   ~wins   installs");
for (const row of rows.slice(-15)) {
  console.log(
    "  " +
      row.tag.padEnd(14) +
      (row.hours.toFixed(1) + "h").padStart(10) +
      String(row.mac).padStart(12) +
      "   " + fmt(estimate(row.mac, row.hours)) +
      String(row.win).padStart(12) +
      "   " + fmt(row.hasWinFeed ? estimate(row.win, row.hours) : null) +
      String(row.installers).padStart(11),
  );
}

// Short windows are noisy: a release that was newest for 20 minutes turns one
// stray fetch into a whole phantom install. Only settled windows vote.
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const settled = rows.filter((r) => r.hours >= 2).slice(-10);
const macs = median(settled.filter((r) => r.hasMacFeed).map((r) => estimate(r.mac, r.hours)));
const wins = median(settled.filter((r) => r.hasWinFeed).map((r) => estimate(r.win, r.hours)));

console.log(`\nmedian over the last ${settled.length} releases that stayed newest 2h+:`);
console.log(`  macOS    ${macs === null ? "no feed shipped" : macs.toFixed(1) + " running"}`);
console.log(`  Windows  ${wins === null ? "no feed shipped -- Windows installs are invisible" : wins.toFixed(1) + " running"}`);

const handInstalls = rows.reduce((sum, r) => sum + r.installers, 0);
console.log(`\n${handInstalls} installer downloads across ${rows.length} releases (manual installs, cumulative).`);
console.log("Counts include crawlers and mirrors, so read these as an upper bound.\n");
' "$RELEASES_JSON"
