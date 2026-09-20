import { useEffect, useRef, useState } from "react";

/**
 * Loudness of a live call, 0..1, sampled from whichever side is talking.
 *
 * This is the one place the voice panel animates continuously, and it runs
 * only while a call is connected: the sampler stops the moment the streams go
 * away, so an idle app never repaints for it.
 */
export function useAudioLevel(streams: ReadonlyArray<MediaStream | null>): number {
  const [level, setLevel] = useState(0);
  const key = streams.map((stream) => stream?.id ?? "").join("|");
  const streamsRef = useRef(streams);
  streamsRef.current = streams;

  useEffect(() => {
    const live = streamsRef.current.filter((stream): stream is MediaStream => stream !== null);
    if (live.length === 0) {
      setLevel(0);
      return;
    }
    const context = new AudioContext();
    const analysers = live.map((stream) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      context.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    });
    const buffer = new Uint8Array(analysers[0]?.frequencyBinCount ?? 0);
    let frame = 0;
    let stopped = false;

    const sample = () => {
      if (stopped) return;
      let peak = 0;
      for (const analyser of analysers) {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      // Speech sits low in this range; lift it so the orb reads as voice.
      setLevel(Math.min(1, peak * 3.2));
      frame = window.requestAnimationFrame(sample);
    };
    frame = window.requestAnimationFrame(sample);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      void context.close().catch(() => undefined);
      setLevel(0);
    };
  }, [key]);

  return level;
}
