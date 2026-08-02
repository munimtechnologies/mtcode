import { useCallback, useEffect, useRef, useState } from "react";

import { transcribeVoiceRecording, type VoiceTranscriptionConfig } from "../lib/voiceTranscription";

const LEVEL_COUNT = 36;
const MAX_RECORDING_MS = 5 * 60 * 1_000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

export type VoiceTranscriptionStatus = "idle" | "recording" | "transcribing";

function supportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function useVoiceTranscription({
  config,
  onTranscript,
}: {
  readonly config: VoiceTranscriptionConfig;
  readonly onTranscript: (text: string) => void;
}) {
  const [status, setStatus] = useState<VoiceTranscriptionStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>(() => Array(LEVEL_COUNT).fill(0.12));
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalsRef = useRef<number[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const configRef = useRef(config);
  const onTranscriptRef = useRef(onTranscript);
  configRef.current = config;
  onTranscriptRef.current = onTranscript;

  const cleanupCapture = useCallback(() => {
    for (const interval of intervalsRef.current) window.clearInterval(interval);
    intervalsRef.current = [];
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      cleanupCapture();
    };
  }, [cleanupCapture]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is not supported on this device.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        if (mountedRef.current) setError("The microphone stopped unexpectedly.");
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        cleanupCapture();
        if (!mountedRef.current) return;
        setStatus("transcribing");
        void transcribeVoiceRecording(blob, configRef.current)
          .then((text) => {
            if (!mountedRef.current) return;
            if (text) onTranscriptRef.current(text);
            setStatus("idle");
            setElapsedMs(0);
          })
          .catch((cause: unknown) => {
            if (!mountedRef.current) return;
            setError(cause instanceof Error ? cause.message : "Voice transcription failed.");
            setStatus("idle");
          });
      });

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      intervalsRef.current.push(
        window.setInterval(() => {
          analyser.getByteFrequencyData(samples);
          setLevels(
            Array.from({ length: LEVEL_COUNT }, (_, index) => {
              const sampleIndex = Math.floor((index / LEVEL_COUNT) * samples.length);
              return Math.max(0.1, (samples[sampleIndex] ?? 0) / 255);
            }),
          );
        }, 80),
      );
      startedAtRef.current = Date.now();
      intervalsRef.current.push(
        window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250),
      );
      timeoutRef.current = window.setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
      recorder.start(250);
      setStatus("recording");
    } catch (cause) {
      cleanupCapture();
      setStatus("idle");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow access and try again."
          : "Could not start the microphone.",
      );
    }
  }, [cleanupCapture, status]);

  return { status, elapsedMs, levels, error, start, stop } as const;
}
