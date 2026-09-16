import {
  McpCapabilityUnavailableError,
  ThreadMetadataMcpUpdateInput,
  ThreadMetadataMcpUpdateResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadMetadataMcp from "../../ThreadMetadataMcpService.ts";

const ThreadUpdateTool = Tool.make("t3_thread_update", {
  description:
    "Update the title of a thread in the calling project when the user or a skill asks. Omit threadId to update this thread. Use action='rename' with title, or action='regenerate_title' with no extra field. Rename saves a manual title that automatic generation will not overwrite. Pull request links are managed with link_pull_request and unlink_pull_request instead; workspace and branch changes are not supported. Reuse clientRequestId for retries within this provider session to avoid repeating the mutation. Results contain the original command receipt and current saved metadata.",
  parameters: ThreadMetadataMcpUpdateInput,
  success: ThreadMetadataMcpUpdateResult,
  failure: Schema.Union([
    McpCapabilityUnavailableError,
    ThreadMetadataMcp.ThreadMetadataThreadNotFoundError,
    ThreadMetadataMcp.ThreadMetadataUpdateFailedError,
  ]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadMetadataMcp.ThreadMetadataMcpService,
  ],
})
  .annotate(Tool.Title, "Update T3 thread metadata")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ThreadMetadataToolkit = Toolkit.make(ThreadUpdateTool);
