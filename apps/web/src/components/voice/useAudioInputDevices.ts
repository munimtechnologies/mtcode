import { useEffect, useState } from "react";

export interface AudioInputDevice {
  readonly deviceId: string;
  readonly label: string;
}

/**
 * Microphones this browser can capture from. Labels stay empty until the user
 * has granted microphone access once, so each device falls back to a stable
 * positional name rather than rendering as a blank row.
 */
export function useAudioInputDevices(): ReadonlyArray<AudioInputDevice> {
  const [devices, setDevices] = useState<ReadonlyArray<AudioInputDevice>>([]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let cancelled = false;
    const read = () => {
      void media
        .enumerateDevices()
        .then((all) => {
          if (cancelled) return;
          const inputs = all.filter((device) => device.kind === "audioinput");
          setDevices(
            inputs.map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label || `Microphone ${index + 1}`,
            })),
          );
        })
        .catch(() => undefined);
    };
    read();
    media.addEventListener?.("devicechange", read);
    return () => {
      cancelled = true;
      media.removeEventListener?.("devicechange", read);
    };
  }, []);

  return devices;
}
