import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";

// Preview builds share nightly branding but ship without an update feed.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

// MT Code publishes a single track (munim-v releases), so it always reads as latest.
export function resolveDefaultDesktopUpdateChannel(
  appVersion: string,
  options?: { readonly singleReleaseChannel?: boolean },
): DesktopUpdateChannel {
  if (options?.singleReleaseChannel) {
    return "latest";
  }

  return desktopUpdateChannelOf(appVersion);
}
