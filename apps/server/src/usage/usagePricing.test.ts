import { describe, expect, it } from "@effect/vitest";

import {
  cacheSavingsUsd,
  createOverrideRateTable,
  lookupRate,
  normalizeModelName,
  parseRateTable,
  priceUsage,
} from "./usagePricing.ts";

const EMPTY_TOTALS = {
  uncachedInputTokens: 1_000_000,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 1_000_000,
  reasoningTokens: 0,
};

const rate = (input: number, cacheRead?: number) => ({
  input_cost_per_token: input,
  output_cost_per_token: input * 5,
  ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

describe("usage pricing", () => {
  const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
  };

  it("uses custom token rates ahead of public and provider-reported costs", () => {
    const table = parseRateTable({ "example-model": rate(1) });
    const overrides = createOverrideRateTable({
      "example-model": {
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 8,
        cacheReadCostPerMillionTokens: 0.5,
        cacheWriteCostPerMillionTokens: 3,
      },
    });

    for (const reportedCostUsd of [null, 99]) {
      expect(priceUsage(table, "example-model", totals, reportedCostUsd, overrides)).toEqual({
        costUsd: 13.5,
        costSource: "modelPriced",
      });
    }
    expect(cacheSavingsUsd(table, "example-model", totals, overrides)).toBe(1.5);
  });

  it("prices unknown models offline and uses input prices for omitted cache rates", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
    });

    expect(priceUsage(table, "example-model", totals, null, overrides)).toEqual({
      costUsd: 14,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, "example-model", totals, overrides)).toBe(0);
  });

  it("preserves explicit zero rates and matches only the exact trimmed model ID", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      " vendor/example-model[1m] ": {
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      },
    });
    expect(priceUsage(table, " vendor/example-model[1m] ", totals, 99, overrides)).toEqual({
      costUsd: 0,
      costSource: "modelPriced",
    });
    for (const model of [
      "example-model[1m]",
      "vendor/example-model",
      "vendor/Example-model[1m]",
      "other/example-model[1m]",
    ]) {
      expect(priceUsage(table, model, totals, null, overrides).costSource).toBe("unpriced");
      expect(priceUsage(table, model, totals, 99, overrides)).toEqual({
        costUsd: 99,
        costSource: "providerReported",
      });
    }
  });

  it("keeps the existing model-name normalization contract", () => {
    expect(normalizeModelName(" Anthropic/Claude-Opus-5 ")).toBe("claude-opus-5");
  });

  it("keeps the canonical Fable rate separate from DeepInfra in either order", () => {
    const canonical = ["claude-fable-5", rate(1e-5, 1e-6)] as const;
    const deepInfra = ["deepinfra/anthropic/claude-fable-5", rate(1e-5)] as const;

    for (const entries of [
      [canonical, deepInfra],
      [deepInfra, canonical],
    ]) {
      const table = parseRateTable(Object.fromEntries(entries));

      expect(lookupRate(table, "claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
      expect(lookupRate(table, "deepinfra/anthropic/claude-fable-5")?.cacheReadCostPerToken).toBe(
        1e-5,
      );
      expect(lookupRate(table, "other/claude-fable-5")).toBeNull();
    }
  });

  it("prices a bracketed context-tier variant at the base model's rate", () => {
    const table = parseRateTable({ "claude-fable-5-1": rate(1e-5, 2.5e-7) });

    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
    expect(lookupRate(table, "anthropic/Claude-Fable-5-1[1m]")).toBeNull();
  });

  it("adds a bare alias when every qualified entry has the same rate", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toEqual(
      lookupRate(table, "provider-a/example-model"),
    );
  });

  it("leaves an ambiguous bare name unpriced", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(3),
    });

    expect(lookupRate(table, "provider-a/example-model")?.inputCostPerToken).toBe(1);
    expect(lookupRate(table, "provider-b/example-model")?.inputCostPerToken).toBe(3);
    expect(lookupRate(table, "example-model")).toBeNull();
  });

  it("drops zero/zero LiteLLM rows so they cannot mask Cursor auto rates", () => {
    const table = parseRateTable({
      "openrouter/openrouter/auto": {
        input_cost_per_token: 0,
        output_cost_per_token: 0,
      },
      "claude-sonnet-4-5": {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 1.5e-5,
      },
    });

    expect(table.has("auto")).toBe(false);
    expect(table.get("claude-sonnet-4-5")?.inputCostPerToken).toBe(3e-6);
  });

  it("does not let a reseller overwrite a canonical bare id", () => {
    const table = parseRateTable({
      "gpt-5.5": { input_cost_per_token: 5e-6, output_cost_per_token: 3e-5 },
      "azure_ai/gpt-5.5": { input_cost_per_token: 9e-6, output_cost_per_token: 9e-5 },
    });

    expect(table.get("gpt-5.5")?.inputCostPerToken).toBe(5e-6);
    expect(lookupRate(table, "gpt-5.5")?.inputCostPerToken).toBe(5e-6);
  });
});

describe("lookupRate", () => {
  const table = parseRateTable({
    "claude-sonnet-4-5": {
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      cache_read_input_token_cost: 3e-7,
      cache_creation_input_token_cost: 3.75e-6,
    },
    "claude-opus-5": {
      input_cost_per_token: 5e-6,
      output_cost_per_token: 2.5e-5,
    },
    "claude-opus-4-6": {
      input_cost_per_token: 5e-6,
      output_cost_per_token: 2.5e-5,
    },
    "gpt-5.5": {
      input_cost_per_token: 5e-6,
      output_cost_per_token: 3e-5,
      cache_read_input_token_cost: 5e-7,
    },
    "gpt-5.3-codex": {
      input_cost_per_token: 1.75e-6,
      output_cost_per_token: 1.4e-5,
    },
  });

  it("prices Cursor Auto Cost flat rates", () => {
    const autoRate = lookupRate(table, "auto");
    expect(autoRate?.inputCostPerToken).toBeCloseTo(1.25 / 1_000_000);
    expect(autoRate?.outputCostPerToken).toBeCloseTo(6 / 1_000_000);
    expect(autoRate?.cacheReadCostPerToken).toBeCloseTo(0.25 / 1_000_000);
  });

  it("prices Composer and Grok from Cursor docs", () => {
    expect(lookupRate(table, "composer-2.5-fast")?.inputCostPerToken).toBeCloseTo(3 / 1_000_000);
    expect(lookupRate(table, "composer-2.5")?.inputCostPerToken).toBeCloseTo(0.5 / 1_000_000);
    expect(lookupRate(table, "cursor-grok-4.5-high-fast")?.inputCostPerToken).toBeCloseTo(
      4 / 1_000_000,
    );
    expect(lookupRate(table, "cursor-grok-4.5-high")?.inputCostPerToken).toBeCloseTo(2 / 1_000_000);
  });

  it("does not strip Composer Fast down to standard Composer rates", () => {
    expect(lookupRate(new Map(), "composer-2.5-fast")?.inputCostPerToken).toBeCloseTo(
      3 / 1_000_000,
    );
  });

  it("maps Cursor Claude/GPT export slugs onto LiteLLM ids", () => {
    expect(lookupRate(table, "claude-4.5-sonnet")?.inputCostPerToken).toBe(3e-6);
    expect(lookupRate(table, "claude-opus-5-thinking-high")?.inputCostPerToken).toBe(5e-6);
    expect(lookupRate(table, "claude-4.6-opus-high-thinking")?.inputCostPerToken).toBe(5e-6);
    expect(lookupRate(table, "gpt-5.5-medium")?.inputCostPerToken).toBe(5e-6);
    expect(lookupRate(table, "gpt-5.3-codex-high")?.inputCostPerToken).toBe(1.75e-6);
  });

  it("prefers provider-reported dollars when present", () => {
    const priced = priceUsage(table, "auto", EMPTY_TOTALS, 0.19);
    expect(priced).toEqual({ costUsd: 0.19, costSource: "providerReported" });
  });

  it("leaves unknown Cursor tooling models unpriced", () => {
    expect(lookupRate(table, "premium")).toBeNull();
    expect(lookupRate(table, "agent_review")).toBeNull();
    expect(normalizeModelName("OpenAI/GPT-5.5")).toBe("gpt-5.5");
  });
});
