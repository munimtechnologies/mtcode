import { useSyncExternalStore } from "react";
import {
  conditionsAt,
  skyKey,
  skyPhaseOf,
  skyWeatherOf,
  type SkyConditions,
  type SkyForecast,
  type SkyPhase,
  type SkyWeather,
} from "./skyConditions";
import { WEATHER_PROVIDERS } from "./weatherProviders";

export type SkyLocation = { latitude: number; longitude: number; name: string };
type Forecast = SkyForecast & { fetchedAt: number };
type Snapshot = {
  location: SkyLocation | null;
  /** The sky right now: the sun and moon from the location, the rest from the forecast. */
  conditions: SkyConditions | null;
  phase: SkyPhase;
  weather: SkyWeather;
  status: string;
  /** A forecast has arrived, so `conditions` carries real weather. */
  ready: boolean;
  /** Which provider the current forecast came from, for attribution. */
  source: { name: string; site: string } | null;
};
const storageKey = "mt-code.sky-location.v1";
const listeners = new Set<() => void>();
let snapshot: Snapshot = {
  location: null,
  conditions: null,
  phase: "night",
  weather: "clear",
  status: "Choose a location to enable the local sky.",
  ready: false,
  source: null,
};
let forecast: Forecast | null = null;
let initialized = false;
let interval: ReturnType<typeof setInterval> | undefined;
let request: AbortController | null = null;
let retryAt = 0;

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function validLocation(value: unknown): value is SkyLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<SkyLocation>;
  return (
    typeof location.latitude === "number" &&
    Number.isFinite(location.latitude) &&
    Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === "number" &&
    Number.isFinite(location.longitude) &&
    Math.abs(location.longitude) <= 180 &&
    typeof location.name === "string"
  );
}

function readLocation(): SkyLocation | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return validLocation(value) ? value : null;
  } catch {
    return null;
  }
}

export function setSkyLocation(location: SkyLocation | null) {
  if (location && !validLocation(location)) return;
  request?.abort();
  request = null;
  forecast = null;
  retryAt = 0;
  // Keep location on this device; server-synced appearance settings contain only the mode.
  const approximate = location
    ? {
        ...location,
        latitude: Math.round(location.latitude * 100) / 100,
        longitude: Math.round(location.longitude * 100) / 100,
      }
    : null;
  try {
    if (approximate) localStorage.setItem(storageKey, JSON.stringify(approximate));
    else localStorage.removeItem(storageKey);
  } catch {
    /* Still usable for this session when storage is unavailable. */
  }
  emit({
    location: approximate,
    conditions: null,
    ready: false,
    source: null,
    status: approximate ? "Updating local sky…" : "Choose a location to enable the local sky.",
  });
  if (listeners.size) void tick();
}

/**
 * Recomputes the sky every tick: the sun and moon move between weather
 * refreshes, so only the clouds wait for the network. Listeners only hear
 * about it when the sky would draw differently.
 */
function updateSky() {
  const location = snapshot.location;
  if (!location) return;
  const conditions = conditionsAt(Date.now(), location, forecast);
  const ready = forecast !== null;
  if (
    snapshot.conditions &&
    ready === snapshot.ready &&
    skyKey(conditions) === skyKey(snapshot.conditions)
  )
    return;
  emit({
    conditions,
    phase: skyPhaseOf(conditions),
    weather: skyWeatherOf(conditions),
    ready,
  });
}

/** Asks each provider in turn; the first usable answer wins. */
async function fetchForecast(location: SkyLocation, controller: AbortController) {
  for (const provider of WEATHER_PROVIDERS) {
    if (controller.signal.aborted) return null;
    // Each provider gets its own deadline so one that hangs still leaves time for the rest.
    const attempt = new AbortController();
    const cancel = () => attempt.abort();
    controller.signal.addEventListener("abort", cancel);
    const timeout = setTimeout(cancel, 8_000);
    try {
      const response = await fetch(provider.url(location), {
        signal: attempt.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) continue;
      const parsed = provider.parse(await response.json(), Date.now());
      if (parsed) return { ...parsed, provider };
    } catch {
      // Network error, timeout or malformed body: try the next provider.
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", cancel);
    }
  }
  return null;
}

async function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  updateSky();
  const location = snapshot.location;
  if (
    !location ||
    request ||
    Date.now() < retryAt ||
    (forecast && Date.now() - forecast.fetchedAt < 15 * 60_000)
  )
    return;
  const controller = new AbortController();
  request = controller;
  if (!forecast) emit({ status: "Updating local sky…" });
  try {
    const result = await fetchForecast(location, controller);
    if (request !== controller) return;
    if (!result) {
      retryAt = Date.now() + 5 * 60_000;
      emit({
        status: forecast
          ? "Weather is unavailable. Showing the last update; retrying shortly."
          : "Weather is unavailable. Showing the sky without weather; retrying shortly.",
      });
      return;
    }
    const { provider, ...next } = result;
    forecast = { ...next, fetchedAt: Date.now() };
    updateSky();
    emit({
      status: "Local sky is up to date.",
      source: { name: provider.name, site: provider.site },
    });
  } finally {
    if (request === controller) request = null;
  }
}

const onVisible = () => {
  void tick();
};
const onStorage = (event: StorageEvent) => {
  if (event.key !== storageKey && event.key !== null) return;
  request?.abort();
  request = null;
  forecast = null;
  retryAt = 0;
  const location = readLocation();
  emit({
    location,
    conditions: null,
    ready: false,
    source: null,
    status: location ? "Updating local sky…" : "Choose a location to enable the local sky.",
  });
  void tick();
};
function subscribe(listener: () => void) {
  if (!initialized) {
    initialized = true;
    snapshot = { ...snapshot, location: readLocation() };
  }
  listeners.add(listener);
  if (listeners.size === 1) {
    interval = setInterval(() => {
      void tick();
    }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    void tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(interval);
      request?.abort();
      request = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    }
  };
}
const getSnapshot = () => snapshot;
const subscribeDisabled = () => () => {};
export function useLocalSky(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribe : subscribeDisabled, getSnapshot, getSnapshot);
}
