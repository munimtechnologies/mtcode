const NIGHTLY_SERVER_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;

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

  return input.version.replace(NIGHTLY_SERVER_VERSION_PATTERN, "");
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
