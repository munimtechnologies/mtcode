import { describe, expect, it } from "vite-plus/test";

import { NETWORK_LOCATION_PROVIDERS } from "./LocalSkySettings";

const [ipwho, geojs, ipinfo] = NETWORK_LOCATION_PROVIDERS;

describe("network location providers", () => {
  it("reads ipwho.is, whose coordinates are numbers", () => {
    expect(
      ipwho!.parse({
        success: true,
        latitude: 40.4167,
        longitude: -86.8753,
        city: "Lafayette",
        region: "Indiana",
        country: "United States",
      }),
    ).toEqual({ latitude: 40.4167, longitude: -86.8753, name: "Lafayette" });
  });

  it("reads geojs, whose coordinates are strings", () => {
    expect(
      geojs!.parse({ latitude: "40.4444", longitude: "-86.9", city: "West Lafayette" }),
    ).toEqual({ latitude: 40.4444, longitude: -86.9, name: "West Lafayette" });
  });

  it("splits ipinfo's single loc field", () => {
    expect(ipinfo!.parse({ loc: "40.4167,-86.8753", city: "Lafayette" })).toEqual({
      latitude: 40.4167,
      longitude: -86.8753,
      name: "Lafayette",
    });
  });

  it("falls back to the region, then the country, for a name", () => {
    expect(ipwho!.parse({ latitude: 1, longitude: 2, city: "", region: "Indiana" })?.name).toBe(
      "Indiana",
    );
    expect(ipwho!.parse({ latitude: 1, longitude: 2, country: "United States" })?.name).toBe(
      "United States",
    );
    expect(ipwho!.parse({ latitude: 1, longitude: 2 })?.name).toBe("Approximate location");
  });

  it("rejects a payload with no usable coordinates", () => {
    // A rate-limited or failed lookup still parses as JSON.
    expect(ipwho!.parse({ success: false, message: "quota" })).toBeNull();
    expect(geojs!.parse({ latitude: "not-a-number", longitude: "0" })).toBeNull();
    expect(ipinfo!.parse({ loc: "91,0" })).toBeNull();
    expect(ipinfo!.parse({})).toBeNull();
  });
});
