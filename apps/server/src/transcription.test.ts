import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe } from "vite-plus/test";

import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  readTranscriptionAudio,
  resolveTranscriptionProvider,
  transcriptionProviderConfig,
} from "./transcription.ts";

describe("transcription providers", () => {
  it("uses a fixed OpenAI endpoint and model", () => {
    expect(resolveTranscriptionProvider("openai")).toBe("openai");
    expect(transcriptionProviderConfig("openai")).toEqual({
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      model: "gpt-4o-mini-transcribe",
    });
  });

  it("uses a fixed Groq endpoint and rejects custom providers", () => {
    expect(resolveTranscriptionProvider("groq")).toBe("groq");
    expect(transcriptionProviderConfig("groq")).toEqual({
      endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
      model: "whisper-large-v3-turbo",
    });
    expect(resolveTranscriptionProvider("http://127.0.0.1:8080/v1")).toBeNull();
  });
});

describe("readTranscriptionAudio", () => {
  it.effect("combines streamed audio chunks", () =>
    Effect.gen(function* () {
      const audio = yield* readTranscriptionAudio(
        Stream.make(new Uint8Array([1, 2]), new Uint8Array([3, 4])),
      );
      expect(Array.from(audio)).toEqual([1, 2, 3, 4]);
    }),
  );

  it.effect("stops when streamed audio exceeds the limit", () =>
    Effect.gen(function* () {
      const error = yield* readTranscriptionAudio(
        Stream.make(new Uint8Array(MAX_TRANSCRIPTION_AUDIO_BYTES), new Uint8Array([1])),
      ).pipe(Effect.flip);
      expect(error._tag).toBe("TranscriptionAudioTooLargeError");
    }),
  );
});
