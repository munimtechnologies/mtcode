import * as Effect from "effect/Effect";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as MonitorSession from "../../MonitorSession.ts";
import { MonitorToolkit } from "./tools.ts";

const invoke = Effect.fn("MonitorToolkit.invoke")(function* (
  operation: "subscribe" | "unsubscribe",
  processId: string,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const sessions = yield* MonitorSession.MonitorSessions;
  if (!scope.capabilities.has("monitor") || scope.thread === undefined)
    return yield* new MonitorSession.MonitorCapabilityError({});
  return yield* sessions.invoke(scope.thread.providerSessionId, operation, processId);
});

export const MonitorToolkitHandlersLive = McpToolAccess.toLayer(MonitorToolkit, {
  monitor_start: McpToolAccess.actsAsCaller(({ command }) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      if (!scope.capabilities.has("monitor") || scope.thread === undefined)
        return yield* new MonitorSession.MonitorCapabilityError({});
      return yield* (yield* MonitorSession.MonitorSessions).start(
        scope.thread.providerSessionId,
        command,
      );
    }),
  ),
  monitor_unsubscribe: McpToolAccess.actsAsCaller(({ processId }) =>
    invoke("unsubscribe", processId),
  ),
});
