import type { SkyForecast } from "./skyConditions";

type Coordinates = { readonly latitude: number; readonly longitude: number };

export type WeatherProvider = {
  readonly name: string;
  readonly site: string;
  readonly url: (location: Coordinates) => string;
  /** A forecast in Open-Meteo's terms (WMO code, cover in %, wind in km/h), or null if unusable. */
  readonly parse: (data: unknown, now: number) => SkyForecast | null;
};

const finite = (value: unknown): number | null => {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
};
const percent = (value: unknown, fallback: number) => {
  const number = finite(value);
  return number === null ? fallback : Math.min(100, Math.max(0, number));
};
/** Providers omit a layer when their model has none; the code still says how grey it is. */
const coverFromCode = (code: number) => (code <= 0 ? 0 : code === 1 ? 20 : code === 2 ? 50 : 95);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const openMeteo: WeatherProvider = {
  name: "Open-Meteo",
  site: "https://open-meteo.com/",
  url: ({ latitude, longitude }) =>
    `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current:
        "weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,visibility",
      timeformat: "unixtime",
    })}`,
  parse: (data) => {
    const current = record(record(data)?.current);
    const code = finite(current?.weather_code);
    if (!current || code === null) return null;
    return {
      code,
      cloudCover: percent(current.cloud_cover, coverFromCode(code)),
      cloudLow: percent(current.cloud_cover_low, 0),
      cloudMid: percent(current.cloud_cover_mid, 0),
      cloudHigh: percent(current.cloud_cover_high, 0),
      wind: percent(current.wind_speed_10m, 8),
      visibility: finite(current.visibility),
    };
  },
};

/** MET Norway symbol codes, without their _day/_night suffix, as WMO codes. */
function codeFromSymbol(symbol: string): number | null {
  const base = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (base.includes("thunder")) return /snow|sleet/.test(base) ? 96 : 95;
  const light = base.startsWith("light");
  const heavy = base.startsWith("heavy");
  const showers = base.endsWith("showers");
  if (base.includes("snow")) return showers ? (heavy ? 86 : 85) : light ? 71 : heavy ? 75 : 73;
  if (base.includes("sleet")) return heavy ? 67 : 66;
  if (base.includes("rain"))
    return showers ? (light ? 80 : heavy ? 82 : 81) : light ? 61 : heavy ? 65 : 63;
  const plain: Record<string, number> = {
    clearsky: 0,
    fair: 1,
    partlycloudy: 2,
    cloudy: 3,
    fog: 45,
  };
  return plain[base] ?? null;
}

const metNorway: WeatherProvider = {
  name: "MET Norway",
  site: "https://api.met.no/",
  url: ({ latitude, longitude }) =>
    `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${latitude}&lon=${longitude}`,
  parse: (data, now) => {
    const series = record(record(data)?.properties)?.timeseries;
    if (!Array.isArray(series)) return null;
    // The latest step that has started, or the first one if the forecast starts later.
    let step: Record<string, unknown> | null = null;
    for (const entry of series) {
      const item = record(entry);
      const time = typeof item?.time === "string" ? Date.parse(item.time) : NaN;
      if (!item || !Number.isFinite(time)) continue;
      if (time <= now || !step) step = item;
      if (time > now) break;
    }
    const stepData = record(step?.data);
    const details = record(record(stepData?.instant)?.details);
    const summary = record(
      record(stepData?.next_1_hours)?.summary ?? record(stepData?.next_6_hours)?.summary,
    );
    const code =
      typeof summary?.symbol_code === "string" ? codeFromSymbol(summary.symbol_code) : null;
    if (!details || code === null) return null;
    const wind = finite(details.wind_speed);
    return {
      code,
      cloudCover: percent(details.cloud_area_fraction, coverFromCode(code)),
      cloudLow: percent(details.cloud_area_fraction_low, 0),
      cloudMid: percent(details.cloud_area_fraction_medium, 0),
      cloudHigh: percent(details.cloud_area_fraction_high, 0),
      wind: wind === null ? 8 : wind * 3.6,
      visibility: null,
    };
  },
};

/** World Weather Online condition codes (what wttr.in reports) as WMO codes. */
const WWO_TO_WMO: Record<number, number> = {
  113: 0,
  116: 2,
  119: 3,
  122: 3,
  143: 45,
  248: 45,
  260: 48,
  176: 80,
  179: 71,
  182: 66,
  185: 56,
  200: 95,
  227: 73,
  230: 75,
  263: 51,
  266: 53,
  281: 56,
  284: 57,
  293: 61,
  296: 61,
  299: 63,
  302: 63,
  305: 65,
  308: 65,
  311: 66,
  314: 67,
  317: 66,
  320: 67,
  323: 71,
  326: 71,
  329: 73,
  332: 73,
  335: 75,
  338: 75,
  350: 77,
  353: 80,
  356: 81,
  359: 82,
  362: 66,
  365: 67,
  368: 85,
  371: 86,
  374: 77,
  377: 77,
  386: 95,
  389: 95,
  392: 96,
  395: 99,
};

const wttr: WeatherProvider = {
  name: "wttr.in",
  site: "https://wttr.in/",
  url: ({ latitude, longitude }) => `https://wttr.in/${latitude},${longitude}?format=j1`,
  parse: (data) => {
    const conditions = record(data)?.current_condition;
    const current = Array.isArray(conditions) ? record(conditions[0]) : null;
    const wwo = finite(current?.weatherCode);
    const code = wwo === null ? undefined : WWO_TO_WMO[wwo];
    if (!current || code === undefined) return null;
    const visibilityKm = finite(current.visibility);
    return {
      code,
      cloudCover: percent(current.cloudcover, coverFromCode(code)),
      cloudLow: 0,
      cloudMid: 0,
      cloudHigh: 0,
      wind: percent(current.windspeedKmph, 8),
      visibility: visibilityKm === null ? null : visibilityKm * 1000,
    };
  },
};

/** Tried in order; Open-Meteo gives the richest cloud layers, the others keep the sky alive when it does not answer. */
export const WEATHER_PROVIDERS: readonly WeatherProvider[] = [openMeteo, metNorway, wttr];
