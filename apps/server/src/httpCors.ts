import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  "x-t3-transcription-api-key",
  "x-t3-transcription-model",
  "x-t3-transcription-provider",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;
