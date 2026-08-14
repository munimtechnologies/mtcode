import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  MOBILE_TRANSCRIPTION_MODEL,
  transcribeMobileVoiceRecording,
} from "./mobileVoiceTranscription";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribeMobileVoiceRecording", () => {
  it("sends an iPhone recording directly to OpenAI", async () => {
    const entries: Array<[string, unknown]> = [];
    vi.stubGlobal(
      "FormData",
      class {
        append(name: string, value: unknown) {
          entries.push([name, value]);
        }
      },
    );
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ text: " hello " }));

    await expect(
      transcribeMobileVoiceRecording("file:///recording.m4a", " secret-key ", fetchMock),
    ).resolves.toBe("hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer secret-key" },
      }),
    );
    expect(entries).toEqual([
      ["model", MOBILE_TRANSCRIPTION_MODEL],
      [
        "file",
        {
          uri: "file:///recording.m4a",
          name: "recording.m4a",
          type: "audio/mp4",
        },
      ],
    ]);
  });
});
