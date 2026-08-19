import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(
  appVersion: string,
  options?: { readonly singleReleaseChannel?: boolean },
): DesktopUpdateChannel {
  if (options?.singleReleaseChannel) {
    return "latest";
  }

  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}
