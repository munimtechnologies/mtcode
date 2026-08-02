export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  "x-t3-transcription-api-key",
  "x-t3-transcription-base-url",
  "x-t3-transcription-model",
] as const;

export const browserApiCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": browserApiCorsAllowedMethods.join(", "),
  "access-control-allow-headers": browserApiCorsAllowedHeaders.join(", "),
} as const;
