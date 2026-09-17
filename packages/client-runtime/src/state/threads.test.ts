import type { OrchestrationThread } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadAllows } from "./threads.ts";

const externalPiThread = {
  backing: {
    kind: "external",
    source: "pi",
    sourceKey: "source",
    control: "readOnly",
    capabilities: {
      send: false,
      attachments: false,
      streamingBehaviors: [],
      interrupt: false,
      stop: false,
      rename: false,
      archive: false,
      settle: true,
      unsettle: true,
      delete: false,
      changeModel: false,
      changeRuntimeMode: false,
      changeInteractionMode: false,
      checkpoints: false,
    },
  },
} as Pick<OrchestrationThread, "backing">;

describe("threadAllows", () => {
  it("allows explicit Pi settlement without enabling generic lifecycle actions", () => {
    expect(threadAllows(externalPiThread, "settle")).toBe(true);
    expect(threadAllows(externalPiThread, "unsettle")).toBe(true);
    expect(threadAllows(externalPiThread, "lifecycle")).toBe(false);
  });

  it("never offers Pi streaming behaviors to internal threads", () => {
    const internalThread = {} as Pick<OrchestrationThread, "backing">;
    expect(threadAllows(internalThread, "steer")).toBe(false);
    expect(threadAllows(internalThread, "followUp")).toBe(false);
    expect(threadAllows(internalThread, "rename")).toBe(true);
  });

  it("offers streaming behaviors only when the external backing lists them", () => {
    expect(threadAllows(externalPiThread, "steer")).toBe(false);
    const streamingPiThread = {
      backing: {
        ...externalPiThread.backing!,
        capabilities: {
          ...externalPiThread.backing!.capabilities,
          streamingBehaviors: ["steer", "followUp"],
        },
      },
    } as Pick<OrchestrationThread, "backing">;
    expect(threadAllows(streamingPiThread, "steer")).toBe(true);
    expect(threadAllows(streamingPiThread, "followUp")).toBe(true);
  });
});
