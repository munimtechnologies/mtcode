import { describe, expect, it } from "vite-plus/test";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { resolveTraitsSelectChange } from "./TraitsPicker";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  currentValue: string,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", options: [...options], currentValue };
}

const EFFORT = selectDescriptor(
  "reasoningEffort",
  [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  "high",
);
const CONTEXT_WINDOW = selectDescriptor(
  "contextWindow",
  [
    { id: "200k", label: "200k" },
    { id: "1m", label: "1M" },
  ],
  "1m",
);

describe("resolveTraitsSelectChange", () => {
  it("routes reasoning selections through the shared preserving transition", () => {
    const modelOptions = [
      { id: "future", value: "keep" },
      { id: "reasoningEffort", value: "high" },
      { id: "contextWindow", value: "1m" },
    ] as const;

    expect(
      resolveTraitsSelectChange({
        caps: { optionDescriptors: [EFFORT, CONTEXT_WINDOW] },
        descriptors: [EFFORT, CONTEXT_WINDOW],
        descriptor: EFFORT,
        value: "max",
        prompt: "unchanged prompt",
        modelOptions,
      }),
    ).toEqual({
      prompt: "unchanged prompt",
      modelOptions: [
        { id: "future", value: "keep" },
        { id: "reasoningEffort", value: "max" },
        { id: "contextWindow", value: "1m" },
      ],
    });
    expect(modelOptions[1]?.value).toBe("high");
  });

  it("retains the generic descriptor path for non-reasoning traits", () => {
    expect(
      resolveTraitsSelectChange({
        caps: { optionDescriptors: [EFFORT, CONTEXT_WINDOW] },
        descriptors: [EFFORT, CONTEXT_WINDOW],
        descriptor: CONTEXT_WINDOW,
        value: "200k",
        prompt: "unchanged prompt",
        modelOptions: [
          { id: "reasoningEffort", value: "high" },
          { id: "contextWindow", value: "1m" },
        ],
      }),
    ).toEqual({
      prompt: "unchanged prompt",
      modelOptions: [
        { id: "reasoningEffort", value: "high" },
        { id: "contextWindow", value: "200k" },
      ],
    });
  });
});
