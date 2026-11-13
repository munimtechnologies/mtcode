const NIGHTLY_SERVER_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;
// The same shape as a suffix, because stripping it has to leave the version
// behind. The anchored pattern above matches the whole string, so reusing it
// for a replace would blank the version out entirely.
const NIGHTLY_VERSION_SUFFIX_PATTERN = /-(?:nightly|preview)\.\d{8}\.\d+$/;

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  if (input.stageLabel.trim().toLowerCase() === "latest") {
    return input.baseName;
  }

  return `${input.baseName} (${input.stageLabel})`;
}

export function formatDisplayedAppVersion(input: {
  readonly version: string;
  readonly stripNightlyPrerelease?: boolean;
}): string {
  if (input.stripNightlyPrerelease === false) {
    return input.version;
  }

  return input.version.replace(NIGHTLY_VERSION_SUFFIX_PATTERN, "");
}

export function resolveHostedAppChannelLabel(channel: string | null | undefined): string | null {
  const normalized = channel?.trim().toLowerCase();
  return normalized === "nightly" ? "Nightly" : normalized === "latest" ? "Latest" : null;
}

/** Stage label of a web build. vite.config.ts stamps it into index.html's title too. */
export function resolveWebAppStageLabel(input: {
  readonly hostedAppChannel: string | null | undefined;
  readonly development: boolean;
}): string {
  return (
    resolveHostedAppChannelLabel(input.hostedAppChannel) ?? (input.development ? "Dev" : "Beta")
  );
}

export function resolveServerBackedAppStageLabel(input: {
  readonly primaryServerVersion: string | null | undefined;
  readonly fallbackStageLabel: string;
  readonly allowNightlyStage?: boolean;
}): string {
  return input.allowNightlyStage !== false &&
    input.primaryServerVersion &&
    NIGHTLY_SERVER_VERSION_PATTERN.test(input.primaryServerVersion)
    ? "Nightly"
    : input.fallbackStageLabel;
}

export function resolveServerBackedAppDisplayName(input: {
  readonly baseName: string;
  readonly fallbackDisplayName: string;
  readonly fallbackStageLabel: string;
  readonly primaryServerVersion: string | null | undefined;
  readonly allowNightlyStage?: boolean;
}): string {
  const stageLabel = resolveServerBackedAppStageLabel({
    primaryServerVersion: input.primaryServerVersion,
    fallbackStageLabel: input.fallbackStageLabel,
    ...(input.allowNightlyStage === undefined
      ? {}
      : { allowNightlyStage: input.allowNightlyStage }),
  });

  return stageLabel === input.fallbackStageLabel
    ? input.fallbackDisplayName
    : formatAppDisplayName({ baseName: input.baseName, stageLabel });
}

/**
 * Names the open thread: `project / thread` on desktop, where the OS already
 * shows the app, with the app name appended in browser tabs.
 */
export function resolveWindowTitle(input: {
  readonly appDisplayName: string;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  /** The screen reader title: status, then thread, then project, since a screen reader reads from the start. */
  readonly screenReader?: { readonly threadStatus: string | null };
  readonly desktop: boolean;
}): string {
  const threadTitle = input.threadTitle?.trim() ?? "";
  const status = input.screenReader?.threadStatus;
  if (threadTitle === "") {
    return status ? `${status}: ${input.appDisplayName}` : input.appDisplayName;
  }

  const projectTitle = input.projectTitle?.trim() ?? "";
  const context =
    projectTitle === ""
      ? threadTitle
      : input.screenReader
        ? `${threadTitle} - ${projectTitle}`
        : `${projectTitle} / ${threadTitle}`;
  const title = status ? `${status}: ${context}` : context;
  return input.desktop ? title : `${title} - ${input.appDisplayName}`;
}
