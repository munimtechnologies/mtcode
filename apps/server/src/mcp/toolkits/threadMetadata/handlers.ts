import * as Effect from "effect/Effect";

import * as ThreadMetadataMcp from "../../ThreadMetadataMcpService.ts";
import * as ThreadMetadataTools from "./tools.ts";

const make = Effect.gen(function* () {
  const metadata = yield* ThreadMetadataMcp.ThreadMetadataMcpService;
  return ThreadMetadataTools.ThreadMetadataToolkit.of({ t3_thread_update: metadata.update });
});

export const ThreadMetadataToolkitHandlersLive =
  ThreadMetadataTools.ThreadMetadataToolkit.toLayer(make);
