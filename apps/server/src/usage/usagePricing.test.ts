import { describe, expect, it } from "@effect/vitest";

import { cursorRateModel } from "./cursorUsageReader.ts";
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
  const record = (model: string, reportedCostUsd: number | null = null, fast = false) => ({
    model,
    totals,
    reportedCostUsd,
    fast,
  });

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
      expect(priceUsage(table, record("example-model", reportedCostUsd), overrides)).toEqual({
        costUsd: 13.5,
        costSource: "modelPriced",
      });
    }
    expect(cacheSavingsUsd(table, record("example-model"), overrides)).toBe(1.5);
  });

  it("prices Cursor cache savings at the base model rate", () => {
    const table = parseRateTable({
      "claude-fable-5-1": rate(10e-6, 1e-6),
      "xai/grok-4.7": rate(2e-6, 0.5e-6),
      "openrouter/x-ai/grok-4.7": rate(3e-6, 0.5e-6),
    });
    const cursorRecord = (model: string) => ({
      ...record(model, 0.25),
      rateModel: cursorRateModel(model),
    });

    expect(cacheSavingsUsd(table, cursorRecord("claude-fable-5-1-thinking-high"))).toBeCloseTo(9);
    expect(cacheSavingsUsd(table, cursorRecord("cursor-grok-4.7-high-fast"))).toBeCloseTo(1.5);
    expect(cacheSavingsUsd(table, cursorRecord("default"))).toBe(0);
    expect(priceUsage(table, cursorRecord("grok-4.7-xhigh-fast"))).toEqual({
      costUsd: 0.25,
      costSource: "providerReported",
    });
  });

  it("prices unknown models offline and uses input prices for omitted cache rates", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
    });

    expect(priceUsage(table, record("example-model"), overrides)).toEqual({
      costUsd: 14,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, record("example-model"), overrides)).toBe(0);
  });

  it("preserves explicit zero rates and matches only the exact trimmed model ID", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      " vendor/example-model[1m] ": {
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      },
    });
    expect(priceUsage(table, record(" vendor/example-model[1m] ", 99), overrides)).toEqual({
      costUsd: 0,
      costSource: "modelPriced",
    });
    for (const model of [
      "example-model[1m]",
      "vendor/example-model",
      "vendor/Example-model[1m]",
      "other/example-model[1m]",
    ]) {
      expect(priceUsage(table, record(model), overrides).costSource).toBe("unpriced");
      expect(priceUsage(table, record(model, 99), overrides)).toEqual({
        costUsd: 99,
        costSource: "providerReported",
      });
    }
  });

  it("prices fast-mode requests at the model's published fast multiple", () => {
    const table = parseRateTable({
      "claude-opus-5-5": { ...rate(4e-6, 2e-7), provider_specific_entry: { fast: 2, us: 1.1 } },
      "claude-fable-5-1": { ...rate(1e-5, 2.5e-7), provider_specific_entry: { us: 1.1 } },
    });
    const overrides = createOverrideRateTable({
      "claude-opus-5-5": { inputCostPerMillionTokens: 4, outputCostPerMillionTokens: 20 },
    });
    const cost = (model: string, fast: boolean, custom?: typeof overrides) =>
      priceUsage(table, record(model, null, fast), custom).costUsd;

    expect(cost("claude-opus-5-5", true)).toBeCloseTo(2 * cost("claude-opus-5-5", false));
    expect(cacheSavingsUsd(table, record("claude-opus-5-5", null, true))).toBeCloseTo(
      2 * cacheSavingsUsd(table, record("claude-opus-5-5")),
    );
    // No published fast tier, and custom prices, both stay at the standard rate.
    expect(cost("claude-fable-5-1", true)).toBe(cost("claude-fable-5-1", false));
    expect(cost("claude-opus-5-5", true, overrides)).toBe(
      cost("claude-opus-5-5", false, overrides),
    );
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
    const priced = priceUsage(table, {
      model: "auto",
      totals: EMPTY_TOTALS,
      fast: false,
      reportedCostUsd: 0.19,
    });
    expect(priced).toEqual({ costUsd: 0.19, costSource: "providerReported" });
  });

  it("leaves unknown Cursor tooling models unpriced", () => {
    expect(lookupRate(table, "premium")).toBeNull();
    expect(lookupRate(table, "agent_review")).toBeNull();
    expect(normalizeModelName("OpenAI/GPT-5.5")).toBe("gpt-5.5");
  });
});
