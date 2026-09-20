import { describe, expect, it } from "vite-plus/test";
import { phaseFromSun, weatherFromCode } from "./skyArtwork";

describe("local sky conditions", () => {
  const rise = Date.parse("2026-09-20T11:30:00Z") / 1000;
  const set = Date.parse("2026-09-20T23:45:00Z") / 1000;
  it("advances through dawn, daylight, dusk and night without waiting for weather refresh", () => {
    expect(phaseFromSun((rise - 15 * 60) * 1000, [rise], [set], false)).toBe("dawn");
    expect(phaseFromSun((rise + 60 * 60) * 1000, [rise], [set], false)).toBe("day");
    expect(phaseFromSun((set + 15 * 60) * 1000, [rise], [set], true)).toBe("dusk");
    expect(phaseFromSun((set + 60 * 60) * 1000, [rise], [set], true)).toBe("night");
  });
  it("uses the location's actual solar times rather than the browser's timezone", () => {
    const nextRise = rise + 86400;
    expect(phaseFromSun(nextRise * 1000, [rise, nextRise], [set, set + 86400], false)).toBe("dawn");
  });
  it("uses the provider daylight flag during polar day and night", () => {
    expect(phaseFromSun(rise * 1000, [0], [0], true)).toBe("day");
    expect(phaseFromSun(rise * 1000, [0], [0], false)).toBe("night");
  });
  it.each([
    [0, "clear"],
    [1, "clear"],
    [2, "cloudy"],
    [3, "cloudy"],
    [45, "fog"],
    [48, "fog"],
    [51, "rain"],
    [67, "rain"],
    [80, "rain"],
    [82, "rain"],
    [71, "snow"],
    [77, "snow"],
    [85, "snow"],
    [86, "snow"],
    [95, "storm"],
    [99, "storm"],
  ])("maps WMO weather code %s to %s", (code, expected) => {
    expect(weatherFromCode(Number(code))).toBe(expected);
  });
});
