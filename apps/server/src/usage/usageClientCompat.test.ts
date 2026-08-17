import { describe, expect, it } from "@effect/vitest";
import {
  HOSTED_USAGE_CONTRACT_VERSION,
  USAGE_CONTRACT_VERSION,
  UsageDay,
  type UsageSummary,
} from "@t3tools/contracts";

import {
  projectUsageSummaryForClient,
  resolveUsageWireContractVersion,
} from "./usageClientCompat.ts";

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-08-17T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: UsageDay.make("2026-08-01"),
    untilDay: UsageDay.make("2026-08-17"),
    buckets: [
      {
        day: UsageDay.make("2026-08-17"),
        provider: "claude",
        model: "claude-opus",
        totals: {
          uncachedInputTokens: 10,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 5,
          reasoningTokens: 0,
        },
        costUsd: 0.01,
        cacheSavingsUsd: 0,
        costSource: "modelPriced",
        records: 1,
        unpricedRecords: 0,
        sessions: 1,
      },
      {
        day: UsageDay.make("2026-08-17"),
        provider: "cursor",
        model: "composer",
        totals: {
          uncachedInputTokens: 20,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 8,
          reasoningTokens: 0,
        },
        costUsd: 0.02,
        cacheSavingsUsd: 0,
        costSource: "providerReported",
        records: 1,
        unpricedRecords: 0,
        sessions: 1,
      },
    ],
    sources: [
      {
        fingerprint: {
          hostId: "mac",
          provider: "claude",
          resolvedHomePath: "/Users/x/.claude",
          volumeId: "1:1",
        },
        status: "ok",
        scannedFiles: 1,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: 1,
        message: null,
      },
      {
        fingerprint: {
          hostId: "mac",
          provider: "cursor",
          resolvedHomePath: "cursor-export",
          volumeId: "",
        },
        status: "ok",
        scannedFiles: 0,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: 1,
        message: null,
      },
    ],
    pricing: {
      status: "fresh",
      source: "https://example.test/rates",
      fetchedAt: "2026-08-17T00:00:00.000Z",
      knownModels: 1,
    },
    scanDurationMs: 12,
    ...overrides,
  };
}

describe("resolveUsageWireContractVersion", () => {
  it("defaults missing clients to the hosted app.t3.codes contract", () => {
    expect(resolveUsageWireContractVersion(undefined)).toBe(HOSTED_USAGE_CONTRACT_VERSION);
  });

  it("keeps the personal contract when the client advertises it", () => {
    expect(resolveUsageWireContractVersion(USAGE_CONTRACT_VERSION)).toBe(USAGE_CONTRACT_VERSION);
  });

  it("projects intermediate versions down to hosted", () => {
    expect(resolveUsageWireContractVersion(HOSTED_USAGE_CONTRACT_VERSION)).toBe(
      HOSTED_USAGE_CONTRACT_VERSION,
    );
    expect(resolveUsageWireContractVersion(5)).toBe(HOSTED_USAGE_CONTRACT_VERSION);
  });
});

describe("projectUsageSummaryForClient", () => {
  it("strips unknown providers for hosted clients so Schema decode succeeds", () => {
    const projected = projectUsageSummaryForClient(summary(), undefined);
    expect(projected.contractVersion).toBe(HOSTED_USAGE_CONTRACT_VERSION);
    expect(projected.buckets.map((bucket) => bucket.provider)).toEqual(["claude"]);
    expect(projected.sources.map((source) => source.fingerprint.provider)).toEqual(["claude"]);
  });

  it("leaves the full personal summary alone for matching clients", () => {
    const full = summary();
    expect(projectUsageSummaryForClient(full, USAGE_CONTRACT_VERSION)).toBe(full);
  });
});
