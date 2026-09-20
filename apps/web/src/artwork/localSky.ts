import { useSyncExternalStore } from "react";
import { phaseFromSun, weatherFromCode, type SkyPhase, type SkyWeather } from "./skyArtwork";

export type SkyLocation = { latitude: number; longitude: number; name: string };
type Forecast = {
  sunrises: number[];
  sunsets: number[];
  isDay: boolean;
  code: number;
  fetchedAt: number;
};
type Snapshot = {
  location: SkyLocation | null;
  phase: SkyPhase;
  weather: SkyWeather;
  status: string;
  ready: boolean;
};
const storageKey = "mt-code.sky-location.v1";
const listeners = new Set<() => void>();
let snapshot: Snapshot = {
  location: null,
  phase: "night",
  weather: "clear",
  status: "Choose a location to enable the local sky.",
  ready: false,
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
    ready: false,
    status: approximate ? "Updating local sky…" : "Choose a location to enable the local sky.",
  });
  if (listeners.size) void tick();
}

function updatePhase() {
  if (!forecast) return;
  emit({
    phase: phaseFromSun(Date.now(), forecast.sunrises, forecast.sunsets, forecast.isDay),
    weather: weatherFromCode(forecast.code),
    ready: true,
  });
}

async function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  updatePhase();
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
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "is_day,weather_code",
      daily: "sunrise,sunset",
      timezone: "auto",
      timeformat: "unixtime",
      forecast_days: "3",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("Weather unavailable");
    const data = (await response.json()) as {
      current?: { is_day?: number; weather_code?: number };
      daily?: { sunrise?: unknown[]; sunset?: unknown[] };
    };
    const rises = data.daily?.sunrise;
    const sets = data.daily?.sunset;
    if (
      !Array.isArray(rises) ||
      !Array.isArray(sets) ||
      rises.length === 0 ||
      rises.length !== sets.length ||
      !rises.every((v) => v === null || (typeof v === "number" && Number.isFinite(v))) ||
      !sets.every((v) => v === null || (typeof v === "number" && Number.isFinite(v))) ||
      ![0, 1].includes(data.current?.is_day ?? -1) ||
      typeof data.current?.weather_code !== "number" ||
      !Number.isFinite(data.current.weather_code)
    )
      throw new Error("Invalid weather response");
    if (request !== controller) return;
    forecast = {
      sunrises: rises.map((v) => (typeof v === "number" ? v : 0)),
      sunsets: sets.map((v) => (typeof v === "number" ? v : 0)),
      isDay: data.current!.is_day === 1,
      code: data.current.weather_code,
      fetchedAt: Date.now(),
    };
    updatePhase();
    emit({ status: "Local sky is up to date." });
  } catch {
    if (request === controller) {
      retryAt = Date.now() + 5 * 60_000;
      emit({
        status: forecast
          ? "Weather is unavailable. Showing the last update; retrying shortly."
          : "Weather is unavailable. Showing Night sky; retrying shortly.",
      });
    }
  } finally {
    clearTimeout(timeout);
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
    ready: false,
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
