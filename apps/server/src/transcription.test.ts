import { expect, it } from "@effect/vitest";
import { describe, vi } from "vite-plus/test";

import { forwardWhisperTranscription, resolveWhisperTranscriptionUrl } from "./transcription.ts";

describe("resolveWhisperTranscriptionUrl", () => {
  it("adds the OpenAI-compatible transcription path", () => {
    expect(resolveWhisperTranscriptionUrl("http://127.0.0.1:8080/v1/")?.toString()).toBe(
      "http://127.0.0.1:8080/v1/audio/transcriptions",
    );
    expect(
      resolveWhisperTranscriptionUrl(
        "https://api.groq.com/openai/v1/audio/transcriptions",
      )?.toString(),
    ).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("rejects non-http and credential-bearing URLs", () => {
    expect(resolveWhisperTranscriptionUrl("file:///tmp/whisper")).toBeNull();
    expect(resolveWhisperTranscriptionUrl("https://user:pass@example.com/v1")).toBeNull();
  });
});

describe("forwardWhisperTranscription", () => {
  it("sends OpenAI-compatible multipart audio with BYOK authorization", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ authorization: "Bearer groq-key" });
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("whisper-large-v3-turbo");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return Response.json({ text: "hello from the microphone" });
    });

    await expect(
      forwardWhisperTranscription(
        {
          audio: new Uint8Array([1, 2, 3]),
          audioMimeType: "audio/webm;codecs=opus",
          baseUrl: "https://api.groq.com/openai/v1",
          model: "whisper-large-v3-turbo",
          apiKey: "groq-key",
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true, text: "hello from the microphone" });
  });

  it("returns a safe provider error", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "bad key" } }, { status: 401 }),
    );
    await expect(
      forwardWhisperTranscription(
        {
          audio: new Uint8Array([1]),
          audioMimeType: "audio/webm",
          baseUrl: "https://example.com/v1",
          model: "whisper-1",
          apiKey: "bad",
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: false, status: 502, message: "bad key" });
  });
});
