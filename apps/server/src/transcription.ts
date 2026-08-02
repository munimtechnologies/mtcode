const TRANSCRIPTION_PATH = "/audio/transcriptions";

export const MAX_TRANSCRIPTION_AUDIO_BYTES = 25 * 1024 * 1024;

export interface WhisperTranscriptionInput {
  readonly audio: Uint8Array;
  readonly audioMimeType: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

type TranscriptionFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type WhisperTranscriptionResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly status: number; readonly message: string };

export function resolveWhisperTranscriptionUrl(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    if (!url.pathname.endsWith(TRANSCRIPTION_PATH)) {
      url.pathname += TRANSCRIPTION_PATH;
    }
    return url;
  } catch {
    return null;
  }
}

function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export async function forwardWhisperTranscription(
  input: WhisperTranscriptionInput,
  fetchImpl: TranscriptionFetch = globalThis.fetch,
): Promise<WhisperTranscriptionResult> {
  const endpoint = resolveWhisperTranscriptionUrl(input.baseUrl);
  if (!endpoint) {
    return { ok: false, status: 400, message: "Enter a valid HTTP transcription endpoint." };
  }
  if (!input.model.trim()) {
    return { ok: false, status: 400, message: "Enter a transcription model." };
  }
  if (input.audio.byteLength === 0) {
    return { ok: false, status: 400, message: "The recording was empty." };
  }
  if (input.audio.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    return { ok: false, status: 413, message: "The recording exceeds the 25 MB limit." };
  }

  const mimeType = input.audioMimeType.split(";", 1)[0]?.trim() || "audio/webm";
  const form = new FormData();
  form.set("model", input.model.trim());
  form.set(
    "file",
    new Blob([input.audio], { type: mimeType }),
    `recording.${audioFileExtension(mimeType)}`,
  );

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : undefined,
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { ok: false, status: 502, message: "Could not reach the transcription provider." };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, message: "The transcription provider returned invalid JSON." };
  }

  if (!response.ok) {
    const providerMessage =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : null;
    return {
      ok: false,
      status: 502,
      message: providerMessage?.slice(0, 300) || "The transcription provider rejected the request.",
    };
  }

  const text =
    typeof payload === "object" && payload !== null && "text" in payload ? payload.text : undefined;
  if (typeof text !== "string") {
    return { ok: false, status: 502, message: "The transcription response did not contain text." };
  }
  return { ok: true, text: text.trim() };
}
