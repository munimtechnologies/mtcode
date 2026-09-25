/**
 * Model rate lookup and cost arithmetic.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json`, the same
 * table `ccusage` prices against, plus Cursor-published rates for Auto /
 * Composer / Grok (export slugs that LiteLLM does not carry). Everything here
 * is pure: fetching and caching the table lives in `UsageService`.
 *
 * @module usagePricing
 */
import type { UsageCostSource, UsageModelPriceOverride } from "@t3tools/contracts";

import type { UsageRecord } from "./usageTranscripts.ts";

/**
 * The subset of a LiteLLM entry we price against. All values are USD per token.
 *
 * LiteLLM also publishes tiered variants (`*_above_272k_tokens`, `*_flex`,
 * `*_priority`, `*_batches`). We deliberately price at the base tier: the
 * transcripts don't record which tier served a request, so anything else would
 * be a guess dressed up as precision.
 */
export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
  /**
   * Multiple of the rates above billed for a fast-mode request, from LiteLLM's
   * `provider_specific_entry.fast`. `1` when the model publishes no fast tier.
   */
  readonly fastMultiplier: number;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/**
 * Custom IDs keep their case, provider prefix, and variant suffix. Custom rates
 * apply as entered, fast-mode requests included.
 */
export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        fastMultiplier: 1,
      },
    ]),
  );
}

/** Raw shape of one LiteLLM entry, narrowed to the fields we read. */
interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
  readonly provider_specific_entry?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Builds a rate from Cursor/docs "$ per million tokens" figures. */
function ratePerMillion(
  input: number,
  output: number,
  cacheRead: number = input,
  cacheWrite: number = input,
): ModelRate {
  return {
    inputCostPerToken: input / 1_000_000,
    outputCostPerToken: output / 1_000_000,
    cacheReadCostPerToken: cacheRead / 1_000_000,
    cacheCreationCostPerToken: cacheWrite / 1_000_000,
  };
}

/**
 * Cursor-native rates (docs: Auto Cost, Composer, Grok 4.5).
 *
 * Export model names are product slugs, not LiteLLM ids. Prefer these over a
 * colliding LiteLLM row (e.g. OpenRouter `auto` at $0/$0).
 *
 * Auto Balance / Intelligence bill at the routed model — the CSV does not say
 * which mode ran, so Auto Cost is the honest flat rate for the `auto` label.
 */
const CURSOR_AUTO_COST = ratePerMillion(1.25, 6, 0.25, 1.25);
const CURSOR_COMPOSER_2 = ratePerMillion(0.5, 2.5);
const CURSOR_COMPOSER_2_FAST = ratePerMillion(1.5, 7.5);
const CURSOR_COMPOSER_2_5 = ratePerMillion(0.5, 2.5);
const CURSOR_COMPOSER_2_5_FAST = ratePerMillion(3, 15);
const CURSOR_GROK_4_5 = ratePerMillion(2, 6, 0.5, 2);
const CURSOR_GROK_4_5_FAST = ratePerMillion(4, 18, 1, 4);

/**
 * Cursor effort / thinking / fast suffixes baked into export model names.
 * Longest-first so `-thinking-high` wins over `-high`.
 */
const CURSOR_PARAM_SUFFIXES = [
  "-thinking-high",
  "-high-thinking",
  "-thinking",
  "-fast-xhigh",
  "-high-fast",
  "-low-fast",
  "-xhigh",
  "-high",
  "-medium",
  "-low",
  "-fast",
] as const;
/** Reads `provider_specific_entry.fast`, e.g. `2` for Claude Opus 5.5. */
function fastMultiplier(entry: LiteLlmEntry): number {
  const specific = entry.provider_specific_entry;
  if (typeof specific !== "object" || specific === null) return 1;
  const fast = finiteNumber((specific as Record<string, unknown>)["fast"]);
  return fast !== null && fast > 0 ? fast : 1;
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * Entries without both an input and an output rate are dropped: a half-priced
 * model would silently under-report cost, which is worse than reporting the
 * model as unpriced. Zero/zero rows (OpenRouter `auto`) are also dropped so
 * they cannot mask a later Cursor-native rate.
 *
 * Entries keep their full normalized key; a bare name is aliased only when no
 * canonical entry exists and every qualified entry has the same rate. That stops
 * reseller rows without cache pricing from collapsing onto a first-party id and
 * overcharging cache reads at the full input rate.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const input = finiteNumber(entry.input_cost_per_token);
    const output = finiteNumber(entry.output_cost_per_token);
    if (input === null || output === null) continue;
    if (input === 0 && output === 0) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    table.set(key, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      // Anthropic bills cache reads at a discount and cache writes at a
      // premium. When a model omits them, cached input is priced as plain
      // input rather than as free.
      cacheReadCostPerToken: finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry.cache_creation_input_token_cost) ?? input,
      fastMultiplier: fastMultiplier(entry),
    });
  }

  // `null` marks a bare name claimed at conflicting rates: no alias for it.
  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) {
      aliasCandidates.set(alias, rate);
    } else if (held !== null && !sameRate(held, rate)) {
      aliasCandidates.set(alias, null);
    }
  }
  for (const [alias, rate] of aliasCandidates) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken &&
    a.fastMultiplier === b.fastMultiplier
  );
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

/**
 * Strips a `provider/` prefix and lowercases, since transcripts are
 * inconsistent about casing.
 */
export function normalizeModelName(model: string): string {
  return bareModelName(normalizeRateKey(model));
}

/**
 * Strips Cursor parameter suffixes (`-thinking-high`, `-medium`, `-fast`, …)
 * so export slugs can hit LiteLLM base model ids.
 */
function stripCursorModelParams(model: string): string {
  let name = normalizeModelName(model);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of CURSOR_PARAM_SUFFIXES) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return name;
}

/**
 * Alternate LiteLLM keys for Cursor / transcript naming variants
 * (`claude-4.5-sonnet` ↔ `claude-sonnet-4-5`).
 */
function modelLookupCandidates(model: string): readonly string[] {
  const normalized = normalizeModelName(model);
  const stripped = stripCursorModelParams(normalized);
  const candidates: string[] = [];
  const push = (name: string) => {
    if (name.length > 0 && !candidates.includes(name)) candidates.push(name);
  };

  push(normalized);
  push(stripped);

  for (const base of [normalized, stripped]) {
    const familyVersion = /^claude-(\d+(?:\.\d+)?)-(opus|sonnet|haiku)$/.exec(base);
    if (familyVersion) {
      const version = familyVersion[1]!;
      const family = familyVersion[2]!;
      const dashed = version.replaceAll(".", "-");
      push(`claude-${family}-${dashed}`);
      push(`claude-${dashed}-${family}`);
      push(`claude-${family}-${version}`);
    }

    const opusVersion = /^claude-opus-(\d+(?:\.\d+)?)$/.exec(base);
    if (opusVersion) {
      const version = opusVersion[1]!;
      const dashed = version.replaceAll(".", "-");
      push(`claude-opus-${dashed}`);
      push(`claude-${dashed}-opus`);
      push(`claude-opus-${version}`);
    }
  }

  return candidates;
}

function cursorNativeRate(normalized: string): ModelRate | null {
  switch (normalized) {
    case "auto":
      return CURSOR_AUTO_COST;
    case "composer-2.5-fast":
      return CURSOR_COMPOSER_2_5_FAST;
    case "composer-2.5":
      return CURSOR_COMPOSER_2_5;
    case "composer-2-fast":
      return CURSOR_COMPOSER_2_FAST;
    case "composer-2":
      return CURSOR_COMPOSER_2;
    default:
      break;
  }

  const withoutCursorPrefix = normalized.startsWith("cursor-")
    ? normalized.slice("cursor-".length)
    : normalized;
  if (withoutCursorPrefix.startsWith("grok-4.5")) {
    return withoutCursorPrefix.includes("fast") ? CURSOR_GROK_4_5_FAST : CURSOR_GROK_4_5;
  }

  return null;
}

/**
 * Drops a bracketed variant suffix such as `claude-fable-5-1[1m]`, which
 * Claude Code writes for the 1M context tier. The rate table only knows the
 * base name, and we price at the base tier anyway.
 */
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

/**
 * Models we never price, regardless of the table.
 *
 * `<synthetic>` marks locally generated messages that were never billed. Bare
 * family names ("opus", "sonnet") are genuinely ambiguous across generations,
 * so we report them as unpriced instead of guessing a generation.
 */
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;

  const exact = table.get(key);
  if (exact) return exact;

  // A missing provider-qualified key must stay unpriced so reseller rows
  // cannot leak through bare aliases (upstream cache-pricing contract).
  if (key.includes("/")) return null;

  // Cursor product rates win over LiteLLM collisions (notably `auto`).
  // Only the exact export slug is checked — never a stripped candidate — so
  // `composer-2.5-fast` cannot fall through to standard Composer rates.
  const native = cursorNativeRate(bareName);
  if (native !== null) return native;

  for (const candidate of modelLookupCandidates(bareName)) {
    const fromTable = table.get(candidate);
    if (fromTable) return fromTable;
  }

  return null;
}

/** The parts of a transcript record that decide its price. */
export type PricedRecord = Pick<UsageRecord, "model" | "totals" | "fast" | "reportedCostUsd">;

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
}

/**
 * Prices one record's tokens.
 *
 * `reasoningTokens` is intentionally not charged separately: it is already
 * counted inside `outputTokens`.
 */
export function priceUsage(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): PricedUsage {
  const { model, totals, reportedCostUsd } = record;
  const override = overrides?.get(model.trim());
  if (override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd)) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  const rate = override ?? lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  const standardCostUsd =
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * rate.cacheReadCostPerToken +
    totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
    totals.outputTokens * rate.outputCostPerToken;

  return {
    costUsd: standardCostUsd * (record.fast ? rate.fastMultiplier : 1),
    costSource: "modelPriced",
  };
}

/**
 * What the cached input would have cost at full input rates, minus what it
 * actually cost. Drives the "cache savings" figure.
 */
export function cacheSavingsUsd(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): number {
  const rate = overrides?.get(record.model.trim()) ?? lookupRate(table, record.model);
  if (rate === null) return 0;
  return (
    record.totals.cachedInputTokens *
    (rate.inputCostPerToken - rate.cacheReadCostPerToken) *
    (record.fast ? rate.fastMultiplier : 1)
  );
}
