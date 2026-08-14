import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";

const OPENAI_API_KEY_STORAGE_KEY = "t3code.voice-transcription.openai-api-key";

export interface MobileVoiceTranscriptionSettingsSnapshot {
  readonly apiKey: string;
  readonly error: string | null;
  readonly loaded: boolean;
  readonly saving: boolean;
}

let snapshot: MobileVoiceTranscriptionSettingsSnapshot = {
  apiKey: "",
  error: null,
  loaded: false,
  saving: false,
};
let loadPromise: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function publish(next: MobileVoiceTranscriptionSettingsSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadMobileVoiceTranscriptionSettings(): Promise<void> {
  if (snapshot.loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  const loadRevision = revision;
  loadPromise = SecureStore.getItemAsync(OPENAI_API_KEY_STORAGE_KEY)
    .then((apiKey) => {
      if (revision !== loadRevision) return;
      publish({ apiKey: apiKey ?? "", error: null, loaded: true, saving: false });
    })
    .catch(() => {
      if (revision !== loadRevision) return;
      publish({
        apiKey: "",
        error: "Could not read the saved API key.",
        loaded: true,
        saving: false,
      });
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

export async function saveMobileVoiceTranscriptionApiKey(apiKey: string): Promise<void> {
  const normalized = apiKey.trim();
  revision += 1;
  publish({ ...snapshot, error: null, saving: true });
  try {
    if (normalized) {
      await SecureStore.setItemAsync(OPENAI_API_KEY_STORAGE_KEY, normalized);
    } else {
      await SecureStore.deleteItemAsync(OPENAI_API_KEY_STORAGE_KEY);
    }
    publish({ apiKey: normalized, error: null, loaded: true, saving: false });
  } catch {
    publish({
      ...snapshot,
      error: "Could not save the API key.",
      loaded: true,
      saving: false,
    });
    throw new Error("Could not save the API key.");
  }
}

export function useMobileVoiceTranscriptionSettings() {
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  useEffect(() => {
    void loadMobileVoiceTranscriptionSettings();
  }, []);
  return current;
}
