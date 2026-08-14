const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
export const MOBILE_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

export async function transcribeMobileVoiceRecording(
  uri: string,
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const form = new FormData();
  form.append("model", MOBILE_TRANSCRIPTION_MODEL);
  form.append("file", {
    uri,
    name: "recording.m4a",
    type: "audio/mp4",
  } as unknown as Blob);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2 * 60 * 1_000);
  try {
    const response = await fetchFn(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey.trim()}` },
      body: form,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      readonly text?: unknown;
      readonly error?: { readonly message?: unknown };
    } | null;
    if (!response.ok) {
      throw new Error(
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "OpenAI rejected the transcription request.",
      );
    }
    if (typeof payload?.text !== "string") {
      throw new Error("OpenAI returned an invalid transcription response.");
    }
    return payload.text.trim();
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("Voice transcription timed out.", { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}
