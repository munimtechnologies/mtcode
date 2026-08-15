import { assert, it } from "@effect/vitest";

import {
  parseClaudeMcpStatusOutput,
  parseCodexMcpStatusOutput,
  parseCursorMcpStatusOutput,
  validateMcpOAuthCallback,
} from "./McpOAuthRuntime.ts";

it("parses Codex OAuth and bearer-token MCP states", () => {
  const statuses = parseCodexMcpStatusOutput(
    JSON.stringify([
      {
        name: "figma",
        enabled: true,
        disabled_reason: null,
        transport: { type: "streamable_http", url: "https://mcp.figma.com/mcp" },
        auth_status: "not_logged_in",
      },
      {
        name: "github",
        enabled: true,
        disabled_reason: null,
        transport: { type: "streamable_http", url: "https://example.com/mcp" },
        auth_status: "bearer_token",
      },
    ]),
  );

  assert.deepStrictEqual(
    statuses.map(({ name, status, canConnect, canDisconnect }) => ({
      name,
      status,
      canConnect,
      canDisconnect,
    })),
    [
      { name: "figma", status: "not_connected", canConnect: true, canDisconnect: false },
      { name: "github", status: "connected", canConnect: false, canDisconnect: false },
    ],
  );
});

it("parses namespaced Claude MCP status lines", () => {
  const statuses = parseClaudeMcpStatusOutput(
    [
      "Checking MCP server health…",
      "plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication",
      "plugin:paper:paper: http://127.0.0.1:29979/mcp (HTTP) - ✘ Failed to connect — Connection refused",
    ].join("\n"),
  );

  assert.strictEqual(statuses[0]?.name, "plugin:figma:figma");
  assert.strictEqual(statuses[0]?.status, "not_connected");
  assert.strictEqual(statuses[0]?.url, "https://mcp.figma.com/mcp");
  assert.strictEqual(statuses[1]?.status, "failed");
});

it("parses Cursor authentication states as externally managed inventory", () => {
  assert.deepStrictEqual(
    parseCursorMcpStatusOutput("Mobbin: requires_authentication\nXcodeBuildMCP: ready").map(
      ({ name, status }) => ({ name, status }),
    ),
    [
      { name: "Mobbin", status: "not_connected" },
      { name: "XcodeBuildMCP", status: "connected" },
    ],
  );
});

it("accepts only the callback URI and state from the active OAuth request", () => {
  const authorizationUrl =
    "https://accounts.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&state=secret-state";

  assert.strictEqual(
    validateMcpOAuthCallback(
      authorizationUrl,
      "http://127.0.0.1:43123/callback?code=authorization-code&state=secret-state",
    ),
    true,
  );
  assert.strictEqual(
    validateMcpOAuthCallback(
      authorizationUrl,
      "http://127.0.0.1:43123/callback?code=authorization-code&state=wrong-state",
    ),
    false,
  );
  assert.strictEqual(
    validateMcpOAuthCallback(
      authorizationUrl,
      "http://127.0.0.1:43124/callback?code=authorization-code&state=secret-state",
    ),
    false,
  );

  const authorizationWithRedirectQuery =
    "https://accounts.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback%3Fsession%3DA";
  assert.strictEqual(
    validateMcpOAuthCallback(
      authorizationWithRedirectQuery,
      "http://127.0.0.1:43123/callback?session=A&code=authorization-code",
    ),
    true,
  );
  assert.strictEqual(
    validateMcpOAuthCallback(
      authorizationWithRedirectQuery,
      "http://127.0.0.1:43123/callback?session=B&code=authorization-code",
    ),
    false,
  );
  assert.strictEqual(
    validateMcpOAuthCallback(
      authorizationWithRedirectQuery,
      "http://127.0.0.1:43123/callback?session=A&session=B&code=authorization-code",
    ),
    false,
  );
});
