import type { VoiceTranscriptionProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export const MAX_TRANSCRIPTION_AUDIO_BYTES = 25 * 1024 * 1024;

const PROVIDERS = {
  openai: {
    endpoint: "https://api.openai.com/v1/audio/transcriptions",
    model: "gpt-4o-mini-transcribe",
  },
  groq: {
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
  },
} as const satisfies Record<VoiceTranscriptionProvider, { endpoint: string; model: string }>;

export interface VoiceTranscriptionInput {
  readonly audio: Uint8Array;
  readonly audioMimeType: string;
  readonly provider: VoiceTranscriptionProvider;
  readonly apiKey: string;
}

export class TranscriptionAudioTooLargeError extends Schema.TaggedErrorClass<TranscriptionAudioTooLargeError>()(
  "TranscriptionAudioTooLargeError",
  { receivedBytes: Schema.Number },
) {
  override get message(): string {
    return "The recording exceeds the 25 MB limit.";
  }
}

export class TranscriptionBodyReadError extends Schema.TaggedErrorClass<TranscriptionBodyReadError>()(
  "TranscriptionBodyReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the recording.";
  }
}

export class TranscriptionEmptyAudioError extends Schema.TaggedErrorClass<TranscriptionEmptyAudioError>()(
  "TranscriptionEmptyAudioError",
  {},
) {
  override get message(): string {
    return "The recording was empty.";
  }
}

export class TranscriptionProviderUnsupportedError extends Schema.TaggedErrorClass<TranscriptionProviderUnsupportedError>()(
  "TranscriptionProviderUnsupportedError",
  {},
) {
  override get message(): string {
    return "Select OpenAI or Groq for transcription.";
  }
}

export class TranscriptionApiKeyMissingError extends Schema.TaggedErrorClass<TranscriptionApiKeyMissingError>()(
  "TranscriptionApiKeyMissingError",
  {},
) {
  override get message(): string {
    return "Add an API key for the selected transcription provider.";
  }
}

export class TranscriptionRequestError extends Schema.TaggedErrorClass<TranscriptionRequestError>()(
  "TranscriptionRequestError",
  {
    provider: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not reach the transcription provider.";
  }
}

export class TranscriptionProviderError extends Schema.TaggedErrorClass<TranscriptionProviderError>()(
  "TranscriptionProviderError",
  {
    provider: Schema.String,
    providerStatus: Schema.Int,
  },
) {
  override get message(): string {
    return "The transcription provider rejected the request. Check the provider and API key.";
  }
}

export class TranscriptionResponseError extends Schema.TaggedErrorClass<TranscriptionResponseError>()(
  "TranscriptionResponseError",
  {
    provider: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "The transcription provider returned an invalid response.";
  }
}

const TranscriptionResponse = Schema.Struct({ text: Schema.String });

export function resolveTranscriptionProvider(provider: string): VoiceTranscriptionProvider | null {
  return provider === "openai" || provider === "groq" ? provider : null;
}

export function transcriptionProviderConfig(provider: VoiceTranscriptionProvider) {
  return PROVIDERS[provider];
}

export const readTranscriptionAudio = <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
  stream.pipe(
    Stream.mapError((cause) => new TranscriptionBodyReadError({ cause })),
    Stream.runFoldEffect(
      () => ({ chunks: [] as Uint8Array[], size: 0 }),
      (accumulator, chunk) => {
        const size = accumulator.size + chunk.byteLength;
        if (size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
          return Effect.fail(new TranscriptionAudioTooLargeError({ receivedBytes: size }));
        }
        accumulator.chunks.push(chunk);
        return Effect.succeed({ chunks: accumulator.chunks, size });
      },
    ),
    Effect.map(({ chunks, size }) => {
      const audio = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return audio;
    }),
  );

function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export const forwardVoiceTranscription = Effect.fn("voiceTranscription.forward")(function* (
  input: VoiceTranscriptionInput,
) {
  if (input.audio.byteLength === 0) {
    return yield* new TranscriptionEmptyAudioError();
  }
  if (input.audio.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    return yield* new TranscriptionAudioTooLargeError({
      receivedBytes: input.audio.byteLength,
    });
  }
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    return yield* new TranscriptionApiKeyMissingError();
  }

  const providerConfig = transcriptionProviderConfig(input.provider);
  const mimeType = input.audioMimeType.split(";", 1)[0]?.trim() || "audio/webm";
  const form = new FormData();
  form.set("model", providerConfig.model);
  form.set(
    "file",
    new Blob([input.audio], { type: mimeType }),
    `recording.${audioFileExtension(mimeType)}`,
  );

  const httpClient = yield* HttpClient.HttpClient;
  const payload = yield* HttpClientRequest.post(providerConfig.endpoint).pipe(
    HttpClientRequest.bearerToken(apiKey),
    HttpClientRequest.bodyFormData(form),
    httpClient.execute,
    Effect.mapError((cause) => new TranscriptionRequestError({ provider: input.provider, cause })),
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        if (response.status < 200 || response.status >= 300) {
          return yield* new TranscriptionProviderError({
            provider: input.provider,
            providerStatus: response.status,
          });
        }
        return yield* HttpClientResponse.schemaBodyJson(TranscriptionResponse)(response).pipe(
          Effect.mapError(
            (cause) => new TranscriptionResponseError({ provider: input.provider, cause }),
          ),
        );
      }),
    ),
    Effect.timeout("2 minutes"),
    Effect.catchTag("TimeoutError", (cause) =>
      Effect.fail(new TranscriptionRequestError({ provider: input.provider, cause })),
    ),
  );
  return payload.text.trim();
});
