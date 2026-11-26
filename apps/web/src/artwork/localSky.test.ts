import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const hook = vi.hoisted(() => ({
  subscribe: null as null | ((listener: () => void) => () => void),
  read: null as null | (() => unknown),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: typeof hook.subscribe, read: () => unknown) => {
    hook.subscribe = subscribe;
    hook.read = read;
    return read();
  },
}));

let cleanup: (() => void) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let saved: Map<string, string>;
const response = (code = 0) => ({
  ok: true,
  json: async () => ({
    current: {
      weather_code: code,
      cloud_cover: code >= 3 ? 95 : 0,
      cloud_cover_low: code >= 3 ? 90 : 0,
      cloud_cover_mid: 0,
      cloud_cover_high: 0,
      wind_speed_10m: 10,
      visibility: 20_000,
    },
  }),
});
const location = { latitude: 40.123456, longitude: -86.123456, name: "Test city" };
async function start(enabled = true) {
  const store = await import("./localSky");
  store.useLocalSky(enabled);
  cleanup = hook.subscribe!(() => {});
  return store;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  // Early afternoon at the test location, so the sun is well up.
  vi.setSystemTime(new Date("2026-09-20T18:00Z"));
  saved = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal("window", new EventTarget());
  fetchMock = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local sky lifecycle", () => {
  it("draws the sun's sky from the location before any forecast arrives", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    expect(hook.read!()).toMatchObject({ ready: false, phase: "day" });
    expect((hook.read!() as { conditions: { sun: number } }).conditions.sun).toBeGreaterThan(30);
  });
  it("carries the forecast's cloud layers into the sky", async () => {
    fetchMock.mockResolvedValue(response(3));
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    expect(hook.read!()).toMatchObject({
      ready: true,
      weather: "cloudy",
      conditions: { low: 0.9, precipitation: "none" },
    });
  });
  it("makes no network request until a location is selected, then sends only rounded coordinates", async () => {
    const store = await start();
    expect(fetchMock).not.toHaveBeenCalled();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.searchParams.get("latitude")).toBe("40.12");
    expect(url.searchParams.get("longitude")).toBe("-86.12");
    expect(hook.read!()).toMatchObject({ ready: true, phase: "day", weather: "clear" });
    expect([...saved.values()][0]).not.toContain("123456");
  });
  it("does not fetch for fixed artwork even with a saved location", async () => {
    saved.set("mt-code.sky-location.v1", JSON.stringify(location));
    await start(false);
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shares refreshes between sidebar and icon, and stops after the last consumer leaves", async () => {
    const store = await start();
    store.setSkyLocation(location);
    const second = hook.subscribe!(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    second();
    cleanup!();
    cleanup = undefined;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps the last scene on failure and recovers on retry", async () => {
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(hook.read!()).toMatchObject({
      ready: true,
      weather: "clear",
      status: expect.stringContaining("last update"),
    });
    fetchMock.mockResolvedValue(response(75));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(hook.read!()).toMatchObject({ ready: true, weather: "snow" });
  });
  it("ignores an old response after clearing the location", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const store = await start();
    store.setSkyLocation(location);
    store.setSkyLocation(null);
    finish(response(95));
    await vi.advanceTimersByTimeAsync(0);
    expect(hook.read!()).toMatchObject({ location: null, ready: false });
    expect(saved.size).toBe(0);
  });
  it("falls back to MET Norway when Open-Meteo is rate-limited", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("open-meteo")
        ? { ok: false, status: 429, json: async () => ({ error: true }) }
        : {
            ok: true,
            json: async () => ({
              properties: {
                timeseries: [
                  {
                    time: "2026-09-20T17:00:00Z",
                    data: {
                      instant: { details: { cloud_area_fraction: 0, wind_speed: 2 } },
                      next_1_hours: { summary: { symbol_code: "clearsky_day" } },
                    },
                  },
                  {
                    time: "2026-09-20T18:00:00Z",
                    data: {
                      instant: {
                        details: {
                          cloud_area_fraction: 100,
                          cloud_area_fraction_low: 90,
                          wind_speed: 5,
                        },
                      },
                      next_1_hours: { summary: { symbol_code: "heavysnow" } },
                    },
                  },
                ],
              },
            }),
          },
    );
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.read!()).toMatchObject({
      ready: true,
      weather: "snow",
      source: { name: "MET Norway" },
      conditions: { low: 0.9 },
    });
  });
  it("falls back to wttr.in when the others are down", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes("wttr.in")) throw new TypeError("Failed to fetch");
      return {
        ok: true,
        json: async () => ({
          current_condition: [
            { weatherCode: "119", cloudcover: "80", windspeedKmph: "12", visibility: "10" },
          ],
        }),
      };
    });
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(hook.read!()).toMatchObject({
      ready: true,
      weather: "cloudy",
      source: { name: "wttr.in" },
      conditions: { low: 0.8 },
    });
  });
  it("moves on from a provider that never answers", async () => {
    fetchMock.mockImplementation((url: string, init: { signal: AbortSignal }) =>
      url.includes("open-meteo")
        ? new Promise((_, reject) =>
            init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
          )
        : Promise.resolve({
            ok: true,
            json: async () => ({
              current_condition: [{ weatherCode: "113", cloudcover: "0" }],
            }),
          }),
    );
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(hook.read!()).toMatchObject({ ready: true, source: { name: "wttr.in" } });
  });
  it("rejects malformed weather rather than showing a false sunny sky", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ current: { cloud_cover: 20 } }) });
    const store = await start();
    store.setSkyLocation(location);
    await vi.advanceTimersByTimeAsync(0);
    expect(hook.read!()).toMatchObject({
      ready: false,
      status: expect.stringContaining("unavailable"),
    });
  });
});
