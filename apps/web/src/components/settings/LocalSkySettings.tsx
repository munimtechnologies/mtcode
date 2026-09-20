import { useEffect, useRef, useState } from "react";
import { setSkyLocation, useLocalSky, type SkyLocation } from "../../artwork/localSky";
import { Button } from "../ui/button";

export function LocalSkySettings() {
  const sky = useLocalSky(true);
  const [city, setCity] = useState("");
  const [results, setResults] = useState<SkyLocation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);

  const search = async () => {
    if (city.trim().length < 2 || busy) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setBusy(true);
    setMessage(null);
    setResults([]);
    try {
      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city.trim(), count: "5", language: "en", format: "json" })}`,
        { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" },
      );
      if (!response.ok) throw new Error("Search unavailable");
      const data = (await response.json()) as {
        results?: {
          latitude: number;
          longitude: number;
          name: string;
          admin1?: string;
          country?: string;
        }[];
      };
      if (!mounted.current) return;
      const places = (data.results ?? [])
        .filter(
          (place) =>
            Number.isFinite(place.latitude) &&
            Number.isFinite(place.longitude) &&
            typeof place.name === "string",
        )
        .map((place) => ({
          latitude: place.latitude,
          longitude: place.longitude,
          name: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
        }));
      setResults(places);
      if (!places.length) setMessage("No cities found. Try a nearby city.");
    } catch {
      if (mounted.current) setMessage("City search is unavailable. Try again shortly.");
    } finally {
      clearTimeout(timeout);
      if (mounted.current) setBusy(false);
    }
  };

  /**
   * Approximate location from the IP address, for when the device's own
   * location service is unavailable or refused. City-level is all this
   * artwork needs: it decides which sky to paint, not where you are.
   */
  const locateByNetwork = async (): Promise<SkyLocation | null> => {
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("https://ipapi.co/json/", {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        latitude?: unknown;
        longitude?: unknown;
        city?: unknown;
        region?: unknown;
        country_name?: unknown;
      };
      if (
        typeof data.latitude !== "number" ||
        !Number.isFinite(data.latitude) ||
        typeof data.longitude !== "number" ||
        !Number.isFinite(data.longitude)
      ) {
        return null;
      }
      const name =
        [data.city, data.region, data.country_name].filter(
          (part): part is string => typeof part === "string" && part.length > 0,
        )[0] ?? "Approximate location";
      return { latitude: data.latitude, longitude: data.longitude, name };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const locate = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    // The device's own service first: it is the more accurate answer and the
    // one that needs no third party. Everything else falls back to the IP,
    // which is the difference between the button working and not -- Linux
    // desktops, machines with location services off, and a browser where the
    // prompt was dismissed all land here.
    const fromDevice = await new Promise<SkyLocation | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            name: "Current location",
          }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30 * 60_000 },
      );
    });
    const place = fromDevice ?? (await locateByNetwork());
    if (!mounted.current) return;
    setBusy(false);
    if (place === null) {
      setMessage("Could not work out where you are. Search for your city instead.");
      return;
    }
    setSkyLocation(place);
    setResults([]);
  };

  return (
    <div className="w-full max-w-sm space-y-2 text-left text-xs">
      <p className="text-muted-foreground">
        Use a city or this device’s location — and if the device will not say, its network address
        is looked up instead. Approximate coordinates are sent to Open-Meteo for daylight and
        weather, and saved only on this device.
      </p>
      <div className="flex gap-2">
        <input
          aria-label="City for sidebar artwork"
          placeholder="Search for a city"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5"
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy || city.trim().length < 2}
          onClick={() => void search()}
        >
          Search
        </Button>
      </div>
      {results.map((place) => (
        <Button
          key={`${place.latitude},${place.longitude}`}
          type="button"
          size="xs"
          variant="ghost"
          className="h-auto w-full justify-start whitespace-normal text-left"
          onClick={() => {
            setSkyLocation(place);
            setResults([]);
            setMessage(null);
          }}
        >
          {place.name}
        </Button>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void locate()}
        >
          {busy ? "Locating / searching…" : "Use my location"}
        </Button>
        {sky.location ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              setSkyLocation(null);
              setMessage(null);
            }}
          >
            Clear location
          </Button>
        ) : null}
      </div>
      <p role="status" className="text-muted-foreground">
        {message ?? `${sky.location ? `${sky.location.name}. ` : ""}${sky.status}`}
      </p>
      <a
        href="https://open-meteo.com/"
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground underline"
      >
        Weather data by Open-Meteo
      </a>
    </div>
  );
}
