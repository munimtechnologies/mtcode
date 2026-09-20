import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const VoiceCredentialStatus = Schema.Struct({
  configured: Schema.Boolean,
});
export type VoiceCredentialStatus = typeof VoiceCredentialStatus.Type;

export const VoiceCredentialInput = Schema.Struct({
  apiKey: TrimmedNonEmptyString,
});
export type VoiceCredentialInput = typeof VoiceCredentialInput.Type;

export const VoiceRealtimeModel = Schema.Literals(["gpt-realtime-2.1-mini", "gpt-realtime-2.1"]);
export type VoiceRealtimeModel = typeof VoiceRealtimeModel.Type;

export const VoiceSessionInput = Schema.Struct({
  model: VoiceRealtimeModel,
});
export type VoiceSessionInput = typeof VoiceSessionInput.Type;

export const VoiceSessionAccess = Schema.Struct({
  clientSecret: Schema.String,
  expiresAt: Schema.Number,
  realtimeUrl: Schema.String,
});
export type VoiceSessionAccess = typeof VoiceSessionAccess.Type;

export const VoiceWebSearchInput = Schema.Struct({
  objective: TrimmedNonEmptyString,
  searchQueries: Schema.Array(TrimmedNonEmptyString),
});
export type VoiceWebSearchInput = typeof VoiceWebSearchInput.Type;

export const VoiceWebExtractInput = Schema.Struct({
  urls: Schema.Array(TrimmedNonEmptyString),
  objective: Schema.optionalKey(TrimmedNonEmptyString),
  searchQueries: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  sessionId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type VoiceWebExtractInput = typeof VoiceWebExtractInput.Type;

export const VoiceWebSource = Schema.Struct({
  url: Schema.String,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  publishDate: Schema.optionalKey(Schema.NullOr(Schema.String)),
  excerpts: Schema.Array(Schema.String),
});
export type VoiceWebSource = typeof VoiceWebSource.Type;

export const VoiceWebSearchResult = Schema.Struct({
  searchId: Schema.String,
  sessionId: Schema.String,
  results: Schema.Array(VoiceWebSource),
});
export type VoiceWebSearchResult = typeof VoiceWebSearchResult.Type;

export const VoiceWebExtractError = Schema.Struct({
  url: Schema.String,
  error: Schema.String,
});
export type VoiceWebExtractError = typeof VoiceWebExtractError.Type;

export const VoiceWebExtractResult = Schema.Struct({
  extractId: Schema.String,
  sessionId: Schema.String,
  results: Schema.Array(VoiceWebSource),
  errors: Schema.Array(VoiceWebExtractError),
});
export type VoiceWebExtractResult = typeof VoiceWebExtractResult.Type;

export const VoiceApiErrorReason = Schema.Literals([
  "credential_not_configured",
  "credential_invalid",
  "parallel_credential_not_configured",
  "parallel_credential_invalid",
  "invalid_web_tool_request",
  "web_tool_unavailable",
  "upstream_unavailable",
  "secret_store_failed",
]);
export type VoiceApiErrorReason = typeof VoiceApiErrorReason.Type;

export class VoiceApiError extends Schema.TaggedError<VoiceApiError>()("VoiceApiError", {
  reason: VoiceApiErrorReason,
  message: Schema.String,
}) {}

export const CodexVoiceSessionInput = Schema.Union([
  // The WebRTC offer is carried verbatim: trimming it strips the trailing CRLF
  // that closes the last SDP line, and the answering server rejects the body.
  Schema.Struct({
    action: Schema.Literal("start"),
    threadId: ThreadId,
    sdp: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64_000)),
  }),
  Schema.Struct({
    action: Schema.Literals(["stop", "heartbeat"]),
    sessionId: TrimmedNonEmptyString,
  }),
]);
export type CodexVoiceSessionInput = typeof CodexVoiceSessionInput.Type;
export const CodexVoiceSessionResult = Schema.Struct({
  sessionId: Schema.String,
  sdp: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export type CodexVoiceSessionResult = typeof CodexVoiceSessionResult.Type;
