import type { VoiceTranscriptionProvider } from "@t3tools/contracts";

import { readDesktopPrimaryBearerToken } from "../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

export const GROQ_TRANSCRIPTION_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";

export interface VoiceTranscriptionConfig {
  readonly provider: VoiceTranscriptionProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export async function transcribeVoiceRecording(
  audio: Blob,
  config: VoiceTranscriptionConfig,
): Promise<string> {
  const bearerToken = await readDesktopPrimaryBearerToken();
  const response = await globalThis.fetch(resolvePrimaryEnvironmentHttpUrl("/api/transcription"), {
    method: "POST",
    credentials: bearerToken ? "omit" : "include",
    headers: {
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      "content-type": audio.type || "audio/webm",
      "x-t3-transcription-base-url": config.baseUrl,
      "x-t3-transcription-model": config.model,
      ...(config.apiKey ? { "x-t3-transcription-api-key": config.apiKey } : {}),
    },
    body: audio,
  });

  const payload = (await response.json().catch(() => null)) as {
    readonly text?: unknown;
    readonly error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string" ? payload.error : "Voice transcription failed.",
    );
  }
  if (typeof payload?.text !== "string") {
    throw new Error("The transcription response did not contain text.");
  }
  return payload.text.trim();
}
