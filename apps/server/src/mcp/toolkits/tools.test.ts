import { expect, it } from "@effect/vitest";
import { McpSchema, Tool } from "effect/unstable/ai";

import { ComputerToolkit } from "./computers/tools.ts";
import { PreviewSnapshotToolkit, PreviewStandardToolkit } from "./preview/tools.ts";

const toolkits = {
  ComputerToolkit,
  PreviewSnapshotToolkit,
  PreviewStandardToolkit,
};

// Every toolkit registered by McpHttpServer.layer must produce an input schema
// the MCP tool contract accepts. Effect 4 rc.112 renders `Schema.Struct({})` as
// `anyOf: [object, array]`, which `McpSchema.Tool` rejects ("Missing key at
// ["type"]"); that registration failure wedged the routes layer build behind
// the activation gate, and the desktop timed out waiting for the backend.
for (const [name, toolkit] of Object.entries(toolkits)) {
  it(`${name} tools render MCP-compatible input schemas`, () => {
    const tools = Object.values(toolkit.tools);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const inputSchema = Tool.getJsonSchema(tool);
      expect(inputSchema, `${tool.name} input schema`).toMatchObject({ type: "object" });
      expect(
        () =>
          new McpSchema.Tool({
            name: tool.name,
            description: Tool.getDescription(tool),
            inputSchema,
          }),
        `${tool.name} McpSchema.Tool`,
      ).not.toThrow();
    }
  });
}
