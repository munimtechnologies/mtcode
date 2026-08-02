import type { VoiceTranscriptionProvider } from "@t3tools/contracts";

import { readDesktopPrimaryBearerToken } from "../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

export interface VoiceTranscriptionConfig {
  readonly provider: VoiceTranscriptionProvider;
  readonly apiKey: string;
}

export async function transcribeVoiceRecording(
  audio: Blob,
  config: VoiceTranscriptionConfig,
): Promise<string> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error("Add an API key for the selected transcription provider.");

  const bearerToken = await readDesktopPrimaryBearerToken();
  const response = await globalThis.fetch(resolvePrimaryEnvironmentHttpUrl("/api/transcription"), {
    method: "POST",
    credentials: bearerToken ? "omit" : "include",
    headers: {
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      "content-type": audio.type || "audio/webm",
      "x-t3-transcription-provider": config.provider,
      "x-t3-transcription-api-key": apiKey,
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
