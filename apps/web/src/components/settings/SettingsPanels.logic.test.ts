import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundActivitySharedPolicySettings,
  getChangedBrowserSettingLabels,
  hasChangedBackgroundActivitySettings,
  hasChangedVoiceTranscriptionSettings,
  normalizeProviderHealthIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_MIN_SECONDS,
  shouldRestoreVoiceTranscriptionDefaults,
  voiceTranscriptionModelOptions,
} from "./SettingsPanels.logic";

describe("voice transcription settings", () => {
  it("only restores voice settings that were included in the confirmed reset", () => {
    const liveSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      voiceTranscriptionApiKey: "key-saved-from-another-tab",
      voiceTranscriptionModel: "gpt-4o-transcribe",
      voiceTranscriptionEnabled: true,
    };

    expect(hasChangedVoiceTranscriptionSettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
    expect(hasChangedVoiceTranscriptionSettings(liveSettings)).toBe(true);
    expect(
      shouldRestoreVoiceTranscriptionDefaults({
        wasIncludedInConfirmation: false,
        liveSettings,
      }),
    ).toBe(false);
    expect(
      shouldRestoreVoiceTranscriptionDefaults({
        wasIncludedInConfirmation: true,
        liveSettings,
      }),
    ).toBe(true);
    expect(
      shouldRestoreVoiceTranscriptionDefaults({
        wasIncludedInConfirmation: true,
        liveSettings: DEFAULT_UNIFIED_SETTINGS,
      }),
    ).toBe(false);
  });

  it("keeps a selected model even when the latest provider list omits it", () => {
    expect(voiceTranscriptionModelOptions(["gpt-4o-mini-transcribe"], "gpt-4o-transcribe")).toEqual(
      ["gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
    );
    expect(
      voiceTranscriptionModelOptions(
        ["gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
        "gpt-4o-transcribe",
      ),
    ).toEqual(["gpt-4o-transcribe", "gpt-4o-mini-transcribe"]);
  });
});

describe("background activity settings restore", () => {
  it("detects legacy interval values even when the structured setting is at its default", () => {
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: Duration.seconds(45),
        providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      }),
    ).toBe(true);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
        providerHealthRefreshInterval: Duration.minutes(7),
      }),
    ).toBe(true);
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });

  it("materializes legacy advanced overrides before changing the shared policy", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          automaticGitFetchInterval,
        },
        "battery-saver",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval,
      },
    });
  });
});

describe("getChangedBrowserSettingLabels", () => {
  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });
});

describe("normalizeProviderHealthIntervalSeconds", () => {
  const min = PROVIDER_HEALTH_INTERVAL_MIN_SECONDS;

  it("keeps zero and values at or above the minimum", () => {
    expect(normalizeProviderHealthIntervalSeconds(0, min)).toBe(0);
    expect(normalizeProviderHealthIntervalSeconds(min, 0)).toBe(min);
    expect(normalizeProviderHealthIntervalSeconds(600, min)).toBe(600);
  });

  it("snaps a value typed below the minimum down to disabled when decreasing", () => {
    expect(normalizeProviderHealthIntervalSeconds(min - 15, min)).toBe(0);
  });

  it("snaps a value typed below the minimum up to the minimum when increasing", () => {
    expect(normalizeProviderHealthIntervalSeconds(15, 0)).toBe(min);
  });

  it("treats a negative value as disabled", () => {
    expect(normalizeProviderHealthIntervalSeconds(-5, min)).toBe(0);
  });
});
