// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  mapClaudeUsageToStatus,
} from "./ClaudeProvider.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

it("maps Claude Code plan windows to the status snapshot", () => {
  assert.deepEqual(
    mapClaudeUsageToStatus(
      {
        session: {
          total_cost_usd: 0,
          total_api_duration_ms: 0,
          total_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
          model_usage: {},
        },
        subscription_type: "pro",
        rate_limits_available: true,
        rate_limits: {
          five_hour: {
            utilization: 66.4,
            resets_at: "2026-08-12T20:49:59.750101+00:00",
          },
          seven_day: {
            utilization: 12,
            resets_at: "2026-08-17T02:59:59.750124+00:00",
          },
        },
        behaviors: {
          day: {
            request_count: 0,
            session_count: 0,
            behaviors: [],
            agents: [],
            skills: [],
            plugins: [],
            mcp_servers: [],
          },
          week: {
            request_count: 0,
            session_count: 0,
            behaviors: [],
            agents: [],
            skills: [],
            plugins: [],
            mcp_servers: [],
          },
        },
      },
      "+50% weekly limits promo through Aug 19 · clau.de/cc-50-promo",
    ),
    {
      rateLimits: {
        currentSession: {
          usedPercent: 66,
          resetsAt: "2026-08-12T20:49:59.750101+00:00",
        },
        currentWeek: {
          usedPercent: 12,
          resetsAt: "2026-08-17T02:59:59.750124+00:00",
        },
        currentWeekPromo: "+50% weekly limits promo through Aug 19 · clau.de/cc-50-promo",
      },
    },
  );
});

it("omits a Claude reset timestamp when the SDK does not provide one", () => {
  const usage = {
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {},
    },
    subscription_type: "pro",
    rate_limits_available: true,
    rate_limits: {
      five_hour: {
        utilization: 10,
        // Older SDK responses can omit this field even though the current
        // generated type declares it as required.
        resets_at: undefined as unknown as string,
      },
      seven_day: {
        utilization: 20,
        resets_at: null,
      },
    },
    behaviors: {
      day: {
        request_count: 0,
        session_count: 0,
        behaviors: [],
        agents: [],
        skills: [],
        plugins: [],
        mcp_servers: [],
      },
      week: {
        request_count: 0,
        session_count: 0,
        behaviors: [],
        agents: [],
        skills: [],
        plugins: [],
        mcp_servers: [],
      },
    },
  };

  assert.deepEqual(mapClaudeUsageToStatus(usage), {
    rateLimits: {
      currentSession: { usedPercent: 10 },
      currentWeek: { usedPercent: 20 },
    },
  });
});

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});
