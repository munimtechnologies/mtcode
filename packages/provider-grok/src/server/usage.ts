/**
 * Usage history for Grok Build: the format of its per-session
 * `updates.jsonl` logs and where each instance's `GROK_HOME` keeps them.
 *
 * @module provider-grok/server/usage
 */

import type { UsageTokenTotals } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import {
  parseTimestampMs,
  tokenCount,
  totalTokens,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
} from "@t3tools/provider-core/server/usage";

import type { GrokSettings } from "../settings.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";

/**
 * Grok reports cost in integer ticks where `1 USD = 10^10` ticks. See Grok
 * headless `total_cost_usd_ticks`. Convert to dollars for pricing.
 */
export const GROK_COST_USD_TICKS_PER_DOLLAR = 10_000_000_000;

function grokCostTicksToUsd(ticks: unknown): number | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  return ticks / GROK_COST_USD_TICKS_PER_DOLLAR;
}

interface GrokUsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly reasoningTokens: number;
  readonly costUsdTicks: number | null;
  readonly costIsPartial: boolean;
  readonly modelCalls: number;
}

function readGrokUsageTotals(value: unknown): GrokUsageTotals | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const dollars = record["costUSD"] ?? record["costUsd"];
  return {
    inputTokens: tokenCount(record["inputTokens"]),
    outputTokens: tokenCount(record["outputTokens"]),
    cachedReadTokens: tokenCount(record["cachedReadTokens"] ?? record["cacheReadInputTokens"]),
    cacheCreationTokens: tokenCount(record["cacheCreationTokens"]),
    reasoningTokens: tokenCount(record["reasoningTokens"]),
    costUsdTicks:
      typeof record["costUsdTicks"] === "number" && Number.isFinite(record["costUsdTicks"])
        ? record["costUsdTicks"]
        : typeof dollars === "number" && Number.isFinite(dollars) && dollars >= 0
          ? dollars * GROK_COST_USD_TICKS_PER_DOLLAR
          : null,
    costIsPartial: record["costIsPartial"] === true,
    modelCalls: Math.max(1, tokenCount(record["modelCalls"])),
  };
}

function grokTotalsToUsage(totals: GrokUsageTotals): UsageTokenTotals {
  const cachedInputTokens = totals.cachedReadTokens;
  const cacheCreationTokens = totals.cacheCreationTokens;
  // Grok reports `inputTokens` inclusive of the cached portion, matching Codex.
  const uncachedInputTokens = Math.max(
    0,
    totals.inputTokens - cachedInputTokens - cacheCreationTokens,
  );
  const outputTokens = totals.outputTokens;
  return {
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, totals.reasoningTokens),
  };
}

/**
 * Parses one line of a Grok session log (`updates.jsonl` and the ACP updates
 * persisted by the Grok adapter).
 *
 * Usage lands on `turn_completed` session updates. Per-model breakdowns live
 * under `usage.modelUsage`; when present each model becomes its own record.
 * A partial provider cost is reported as unknown rather than as a complete
 * figure, so it never understates a turn.
 *
 * Returns every record for the line (0 or more). Callers stream line-by-line
 * and flatten.
 */
export function parseGrokLine(line: string): readonly UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  return parseGrokRecord(parsed);
}

function parseGrokRecord(parsed: unknown): readonly UsageRecord[] {
  if (typeof parsed !== "object" || parsed === null) return [];

  const record = parsed as Record<string, unknown>;
  const params = record["params"];
  if (typeof params !== "object" || params === null) return [];
  const paramsRecord = params as Record<string, unknown>;

  const update = paramsRecord["update"];
  if (typeof update !== "object" || update === null) return [];
  const updateRecord = update as Record<string, unknown>;
  // Gate on the turn marker when the log carries one. Records without the
  // field at all are accepted: the adapter's own captures omit it, and their
  // usage block is already the completed-turn aggregate.
  const sessionUpdate = updateRecord["sessionUpdate"];
  if (sessionUpdate !== undefined && sessionUpdate !== "turn_completed") return [];

  const usage = updateRecord["usage"];
  if (typeof usage !== "object" || usage === null) return [];
  const usageRecord = usage as Record<string, unknown>;

  const sessionId = typeof paramsRecord["sessionId"] === "string" ? paramsRecord["sessionId"] : "";
  const promptId = typeof updateRecord["prompt_id"] === "string" ? updateRecord["prompt_id"] : null;

  // Prefer the high-resolution agent clock; fall back to the outer unix seconds.
  const meta = paramsRecord["_meta"];
  let eventId: string | null = null;
  let timestampMs: number | null = null;
  if (typeof meta === "object" && meta !== null) {
    const metaRecord = meta as Record<string, unknown>;
    if (typeof metaRecord["eventId"] === "string") eventId = metaRecord["eventId"];
    const agentTimestampMs = metaRecord["agentTimestampMs"];
    if (typeof agentTimestampMs === "number" && Number.isFinite(agentTimestampMs)) {
      timestampMs = agentTimestampMs;
    }
  }
  if (timestampMs === null) {
    const timestamp = record["timestamp"];
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      // Grok's persisted updates use Unix seconds. Accept milliseconds too so a
      // format precision bump does not move records thousands of years out.
      timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
    } else {
      timestampMs = parseTimestampMs(timestamp);
    }
  }
  if (timestampMs === null) return [];

  // A turn identity beats hashing the payload: two identical turns are real
  // usage twice, not a duplicate.
  const turnId = promptId ?? eventId;
  const dedupeKeyFor = (model: string): string | null =>
    turnId === null ? null : `${sessionId}:${turnId}:${model}`;

  const topLevel = readGrokUsageTotals(usageRecord);
  if (topLevel === null) return [];

  const modelUsage = usageRecord["modelUsage"];
  const modelEntries: Array<{ model: string; totals: GrokUsageTotals }> = [];
  if (typeof modelUsage === "object" && modelUsage !== null) {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
      if (model.length === 0) continue;
      const totals = readGrokUsageTotals(raw);
      if (totals === null) continue;
      modelEntries.push({ model, totals });
    }
  }

  if (modelEntries.length === 0) {
    if (totalTokens(grokTotalsToUsage(topLevel)) === 0) return [];
    return [
      {
        provider: "grok",
        timestampMs,
        model: "grok",
        sessionId,
        totals: grokTotalsToUsage(topLevel),
        recordCount: topLevel.modelCalls,
        reportedCostUsd: topLevel.costIsPartial ? null : grokCostTicksToUsd(topLevel.costUsdTicks),
        speed: "standard",
        // No turn id means we cannot tell two same-second updates apart.
        dedupeKey: dedupeKeyFor("grok"),
      },
    ];
  }

  // Cost allocation:
  // 1. Emitted models with their own costUsdTicks keep those values.
  // 2. Remaining aggregate cost (top-level minus those per-model ticks,
  //    clamped at 0) is pro-rated across emitted models that lack ticks,
  //    by token share among the unticked models only.
  // 3. When no model has per-model ticks, remaining equals the full
  //    aggregate and every emitted model gets a token-share slice.
  // Zero-token rows are never emitted and never count toward used ticks.
  const topLevelCostUsd = topLevel.costIsPartial ? null : grokCostTicksToUsd(topLevel.costUsdTicks);
  let usedTickedCostUsd = 0;
  let untickedTokenDenominator = 0;
  for (const entry of modelEntries) {
    const tokens = totalTokens(grokTotalsToUsage(entry.totals));
    if (tokens === 0) continue;
    if (entry.totals.costUsdTicks !== null) {
      usedTickedCostUsd += grokCostTicksToUsd(entry.totals.costUsdTicks) ?? 0;
    } else {
      untickedTokenDenominator += tokens;
    }
  }
  const remainingCostUsd =
    topLevelCostUsd === null ? null : Math.max(0, topLevelCostUsd - usedTickedCostUsd);

  const results: UsageRecord[] = [];
  for (const entry of modelEntries) {
    const totals = grokTotalsToUsage(entry.totals);
    if (totalTokens(totals) === 0) continue;

    // A partial cost anywhere in the turn makes every slice of it a guess.
    const costIsPartial = topLevel.costIsPartial || entry.totals.costIsPartial;
    let reportedCostUsd = costIsPartial ? null : grokCostTicksToUsd(entry.totals.costUsdTicks);
    if (
      !costIsPartial &&
      reportedCostUsd === null &&
      remainingCostUsd !== null &&
      untickedTokenDenominator > 0
    ) {
      reportedCostUsd = remainingCostUsd * (totalTokens(totals) / untickedTokenDenominator);
    }

    results.push({
      provider: "grok",
      timestampMs,
      model: entry.model,
      sessionId,
      totals,
      recordCount: entry.totals.modelCalls,
      reportedCostUsd,
      speed: "standard",
      dedupeKey: dedupeKeyFor(entry.model),
    });
  }
  return results;
}

export const grokUsageFormat: TranscriptUsageFormat<void> = {
  selectFields: {
    timestamp: true,
    params: {
      sessionId: true,
      _meta: { agentTimestampMs: true, eventId: true },
      update: { sessionUpdate: true, prompt_id: true, usage: true },
    },
  },
  // Usage lands on turn_completed updates, but the adapter's captured ACP
  // updates may only carry the per-model breakdown, so accept either marker.
  mightCarryUsage: (line) => line.includes('"turn_completed"') || line.includes('"modelUsage"'),
  parseLine: (line) => parseGrokLine(line),
  parseProjected: (projected) => parseGrokRecord(projected),
};

export const grokUsageReader: ProviderUsageReader<GrokSettings, Path.Path> = {
  kind: "transcripts",
  provider: "grok",
  format: grokUsageFormat,
  directories: Effect.fn("grokUsageReader.directories")(function* ({ environment }) {
    const path = yield* Path.Path;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const home = expandHomePath(
      environment.GROK_HOME?.trim() || path.join(homeDirectory, ".grok"),
      homeDirectory,
    );
    // Sessions also ship multi-megabyte `chat_history` and `events` logs that
    // never carry usage; only `updates.jsonl` does.
    return [{ dir: path.resolve(home, "sessions"), fileName: "updates.jsonl" }];
  }),
};
