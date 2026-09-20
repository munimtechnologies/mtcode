export type SkyPhase = "dawn" | "day" | "dusk" | "night";
export type SkyWeather = "clear" | "cloudy" | "rain" | "snow" | "fog" | "storm";
export const SKY_PHASES: readonly SkyPhase[] = ["dawn", "day", "dusk", "night"];
export const SKY_WEATHER: readonly SkyWeather[] = [
  "clear",
  "cloudy",
  "rain",
  "snow",
  "fog",
  "storm",
];
export const isLocalSky = (selection: string) =>
  selection === "local-day-night" || selection === "local-weather";
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);
export const SKY_OPTIONS = SKY_PHASES.flatMap((phase) =>
  SKY_WEATHER.map((weather) => ({
    value: `sky-${phase}-${weather}`,
    label: `${title(phase)} · ${title(weather)}`,
    phase,
    weather,
  })),
);

export function weatherFromCode(code: number): SkyWeather {
  if (code >= 95) return "storm";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if (code >= 51 && code <= 82) return "rain";
  if (code === 45 || code === 48) return "fog";
  return code >= 2 ? "cloudy" : "clear";
}

export function phaseFromSun(
  now: number,
  sunrises: readonly number[],
  sunsets: readonly number[],
  isDay: boolean,
): SkyPhase {
  const twilight = 30 * 60 * 1000;
  if (sunrises.some((time) => Math.abs(now - time * 1000) <= twilight)) return "dawn";
  if (sunsets.some((time) => Math.abs(now - time * 1000) <= twilight)) return "dusk";
  // Derive daylight from the entire forecast, so it advances between weather refreshes.
  for (let index = 0; index < sunrises.length; index++) {
    const rise = sunrises[index]! * 1000;
    const set = (sunsets[index] ?? 0) * 1000;
    if (now >= rise && now < set) return "day";
  }
  const valid = sunrises.filter((time) => time > 0);
  if (
    valid.length &&
    now >= valid[0]! * 1000 - 86400000 &&
    now <= valid[valid.length - 1]! * 1000 + 86400000
  )
    return "night";
  return isDay ? "day" : "night";
}

/**
 * Every scene is the Nightly sky repainted: same diagonal gradient, same glow,
 * same two cloud banks and star field, with a palette chosen for that hour and
 * that weather. `night`/`cloudy` is the Nightly artwork's own palette.
 *
 * [bottom, mid, top, glow, cloudA, cloudB, cloudC]
 */
type Scene = readonly [string, string, string, string, string, string, string];

const scenes: Record<SkyPhase, Record<SkyWeather, Scene>> = {
  dawn: {
    clear: ["#111a46", "#2f2a63", "#f0a171", "#ffb27a", "#ffc79b", "#e78fa0", "#a97ddc"],
    cloudy: ["#161d4c", "#3b3270", "#e09a7a", "#ffab80", "#ffc9a6", "#e894a8", "#ac86df"],
    rain: ["#0f1734", "#2a2c52", "#7b7098", "#8d86b8", "#b3c6e6", "#a9a6dd", "#b498dc"],
    snow: ["#16203f", "#333a63", "#b9b6cd", "#cfd2ec", "#cfe2fb", "#bcc0f0", "#cbb2f2"],
    fog: ["#131a33", "#2f3354", "#a89fb2", "#bdb5cd", "#c8d3e8", "#c2bfe0", "#cbb3e0"],
    storm: ["#080d26", "#1b1c44", "#4a3f68", "#5b5390", "#4c74a6", "#4b4b96", "#69479a"],
  },
  day: {
    clear: ["#1360c4", "#3d8ade", "#bfe3fa", "#ffe9b0", "#ffffff", "#cfe8ff", "#e4d8ff"],
    cloudy: ["#2a72c0", "#5e9ad6", "#c9e2f4", "#f4fbff", "#ffffff", "#d8ecff", "#e8dcff"],
    rain: ["#26415e", "#46637f", "#8ea4b8", "#a9bdd0", "#c6dbee", "#b8c4de", "#c1b4de"],
    snow: ["#4a6684", "#7691ad", "#cfe0ec", "#eaf4ff", "#ffffff", "#e2ecff", "#efe4ff"],
    fog: ["#465a6b", "#78909f", "#cfdadf", "#e6eef2", "#e2ecf4", "#d8dcec", "#ded0ee"],
    storm: ["#161f3c", "#2c3b60", "#5a6a8c", "#7b87b4", "#6389b4", "#5f66a8", "#7a54a6"],
  },
  dusk: {
    clear: ["#101038", "#43206b", "#e8794f", "#ff9a5e", "#ffb487", "#e0748f", "#ab63d6"],
    cloudy: ["#171445", "#4a2570", "#d9734f", "#f08c63", "#ffc09a", "#e2809d", "#b06fda"],
    rain: ["#0d0f2e", "#33255a", "#6a4a7a", "#8a6fae", "#a3b4df", "#9a86d2", "#b07fd4"],
    snow: ["#141a3c", "#3a2f63", "#b3a8c4", "#d2cdf0", "#ccdcf8", "#b9b4ee", "#c9a9ee"],
    fog: ["#111129", "#31284f", "#9b86a0", "#b79fbe", "#c3cae8", "#bbaede", "#c69ed8"],
    storm: ["#06071c", "#1a1040", "#48305f", "#5f4894", "#4a6aa4", "#4b4098", "#6a3a9c"],
  },
  night: {
    clear: ["#050f24", "#101038", "#2a1050", "#5165d8", "#4ea4ff", "#696fea", "#a85bea"],
    cloudy: ["#07152f", "#151443", "#32155b", "#5165d8", "#4ea4ff", "#696fea", "#a85bea"],
    rain: ["#050f26", "#101336", "#241450", "#3f4f9e", "#3d7fc4", "#4f56b0", "#6d4aa6"],
    snow: ["#0a1730", "#181b45", "#2e2358", "#6d82d8", "#8fc0f2", "#9aa5ef", "#c39cf0"],
    fog: ["#0a1120", "#171a33", "#281c42", "#46538f", "#8ba4ce", "#8e96d2", "#a98dd0"],
    storm: ["#03071a", "#0b0d2c", "#1d0f3f", "#333f80", "#2d5b8d", "#3a3f86", "#53357e"],
  },
};

/** Where the glow sits, and the sun or moon a clear sky puts inside it. */
const luminaries: Record<SkyPhase, readonly [number, number, number]> = {
  dawn: [238, 58, 8],
  day: [226, 22, 7],
  dusk: [52, 60, 9],
  night: [216, 18, 8],
};

/** The Nightly artwork's own cloud banks, anchored to the bottom edge. */
const CLOUD_LEFT =
  "M-12 88C-12 74 0 63 14 63C18 50 30 41 44 41C58 41 70 49 74 62C79 57 86 54 94 54C110 54 123 66 124 82C132 83 138 88 141 96H-12V88Z";
const CLOUD_RIGHT =
  "M150 96C151 84 161 75 173 75C176 64 186 57 198 57C210 57 220 64 223 75C231 75 238 80 241 87C250 87 257 91 260 96H150Z";

/** [path, translate, opacity] — more weather means more of the same two banks. */
const decks: Record<SkyWeather, ReadonlyArray<readonly [string, string, number]>> = {
  clear: [],
  cloudy: [
    [CLOUD_LEFT, "translate(0 0)", 1],
    [CLOUD_RIGHT, "translate(0 0)", 0.8],
  ],
  rain: [
    [CLOUD_LEFT, "translate(104 -26)", 0.92],
    [CLOUD_RIGHT, "translate(-108 -20)", 0.85],
    [CLOUD_LEFT, "translate(0 6)", 0.95],
    [CLOUD_LEFT, "translate(58 -2)", 0.9],
    [CLOUD_RIGHT, "translate(0 6)", 0.8],
  ],
  snow: [
    [CLOUD_LEFT, "translate(104 -24)", 0.8],
    [CLOUD_RIGHT, "translate(-108 -18)", 0.72],
    [CLOUD_LEFT, "translate(0 8)", 0.88],
    [CLOUD_LEFT, "translate(58 0)", 0.82],
    [CLOUD_RIGHT, "translate(0 8)", 0.74],
  ],
  storm: [
    [CLOUD_LEFT, "translate(96 -34)", 1],
    [CLOUD_RIGHT, "translate(-96 -30)", 0.95],
    [CLOUD_LEFT, "translate(8 -6)", 1],
    [CLOUD_LEFT, "translate(56 -8)", 0.95],
    [CLOUD_RIGHT, "translate(-6 -2)", 0.9],
  ],
  fog: [
    [CLOUD_LEFT, "translate(120 -18)", 0.35],
    [CLOUD_RIGHT, "translate(-120 -14)", 0.3],
    [CLOUD_LEFT, "translate(-30 4)", 0.45],
    [CLOUD_LEFT, "translate(56 -4)", 0.42],
    [CLOUD_RIGHT, "translate(24 2)", 0.4],
  ],
};

const STARS: ReadonlyArray<readonly [number, number, number, number]> = [
  [14, 10, 0.6, 0.85],
  [38, 22, 0.4, 0.55],
  [58, 8, 0.5, 0.7],
  [84, 16, 0.4, 0.5],
  [104, 7, 0.6, 0.8],
  [126, 20, 0.4, 0.55],
  [148, 11, 0.5, 0.7],
  [170, 24, 0.4, 0.5],
  [192, 9, 0.6, 0.8],
  [214, 18, 0.4, 0.55],
  [236, 8, 0.5, 0.7],
  [258, 20, 0.45, 0.6],
  [278, 11, 0.55, 0.75],
  [26, 34, 0.4, 0.45],
  [118, 34, 0.4, 0.45],
  [202, 32, 0.4, 0.5],
  [268, 34, 0.4, 0.45],
];

const SPARKLES: ReadonlyArray<readonly [number, number]> = [
  [70, 28],
  [160, 36],
  [246, 26],
];

const starField = `<g fill="#e4eaff">${STARS.map(([x, y, r, opacity]) => `<circle cx="${x}" cy="${y}" r="${r}" fill-opacity="${opacity}"/>`).join("")}</g><g stroke="#c8d7ff" stroke-linecap="round" stroke-opacity=".7" stroke-width=".6">${SPARKLES.map(([x, y]) => `<path d="M${x - 1.5} ${y}H${x + 1.5}"/><path d="M${x} ${y - 1.5}V${y + 1.5}"/>`).join("")}</g>`;

/** Hash-based jitter: a grid of drops reads as a pattern, not as weather. */
const noise = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

function precipitation(weather: SkyWeather, tint: string): string {
  const count = weather === "storm" ? 52 : weather === "rain" ? 42 : 36;
  return Array.from({ length: count }, (_, index) => {
    const x = (noise(index) * 300 - 6).toFixed(1);
    const y = (18 + noise(index + 91) * 62).toFixed(1);
    if (weather === "snow")
      return `<circle cx="${x}" cy="${y}" r="${(0.6 + noise(index + 43) * 0.7).toFixed(2)}" fill="${tint}" opacity="${(0.4 + noise(index + 17) * 0.45).toFixed(2)}"/>`;
    const storm = weather === "storm";
    const length = ((storm ? 7 : 4.5) + noise(index + 61) * 4).toFixed(1);
    return `<path d="M${x} ${y}l${storm ? -3.2 : -1.9} ${length}" stroke="${tint}" stroke-width="${storm ? ".75" : ".65"}" stroke-linecap="round" opacity="${(0.3 + noise(index + 17) * 0.32).toFixed(2)}"/>`;
  }).join("");
}

/**
 * A strike is a long, wandering filament lit by its own flash. A bolt glyph
 * would make the sky look like a weather app's icon row, so the path is walked
 * down from the cloud mass with jittered steps and a branch off its middle.
 */
function filament(seed: number, x: number, top: number, bottom: number) {
  const points: Array<readonly [number, number]> = [[x, top]];
  let cursor = [x, top] as const;
  for (let step = 0; cursor[1] < bottom; step++) {
    cursor = [
      cursor[0] + (noise(seed + step + 50) - 0.5) * 11,
      cursor[1] + 4 + noise(seed + step) * 7,
    ];
    points.push(cursor);
  }
  return points;
}

const trace = (points: ReadonlyArray<readonly [number, number]>) =>
  points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");

const mainStrike = filament(3, 186, 14, 78);
const fork = mainStrike[Math.floor(mainStrike.length / 2)]!;
const strikes = [
  trace(mainStrike),
  trace(filament(21, fork[0], fork[1], fork[1] + 22)),
  trace(filament(41, 72, 16, 50)),
];
const lightning = `<ellipse cx="186" cy="34" rx="88" ry="54" fill="url(#flash)"/>
<g fill="none" stroke="#e4eaff" stroke-linecap="round" stroke-linejoin="round">
 <g filter="url(#soft)" opacity=".4"><path d="${strikes[0]}" stroke-width="2.8"/><path d="${strikes[1]}" stroke-width="1.8"/></g>
 <path d="${strikes[0]}" stroke-width=".65" opacity=".92"/>
 <path d="${strikes[1]}" stroke-width=".4" opacity=".6"/>
 <path d="${strikes[2]}" stroke-width=".4" opacity=".22"/>
</g>`;

export function skyArtworkSvg(phase: SkyPhase, weather: SkyWeather): string {
  const [bottom, mid, top, glow, cloudA, cloudB, cloudC] = scenes[phase][weather];
  const [orbX, orbY, orbR] = luminaries[phase];
  const misty = weather === "fog";
  // Stars only show through where the sky is actually open.
  const starOpacity =
    phase === "day" || (weather !== "clear" && weather !== "cloudy")
      ? 0
      : phase === "night"
        ? 1
        : phase === "dusk"
          ? 0.55
          : 0.3;
  const orb =
    weather !== "clear"
      ? ""
      : phase === "night"
        ? `<circle cx="${orbX}" cy="${orbY}" r="${orbR}" fill="#e4eaff" mask="url(#crescent)" opacity=".92"/>`
        : `<circle cx="${orbX}" cy="${orbY}" r="${orbR}" fill="${glow}" opacity=".45"/><circle cx="${orbX}" cy="${orbY}" r="${orbR - 1.5}" fill="#fff5e2" opacity="${phase === "day" ? ".95" : ".85"}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1152" height="384" viewBox="0 0 288 96" fill="none">
<defs>
 <linearGradient id="sky" x1="24" y1="0" x2="264" y2="96" gradientUnits="userSpaceOnUse" spreadMethod="reflect"><stop stop-color="${bottom}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${top}"/></linearGradient>
 <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${orbX} ${orbY}) rotate(137) scale(${misty ? 150 : 120} ${misty ? 96 : 84})"><stop stop-color="${glow}" stop-opacity="${misty ? ".3" : ".4"}"/><stop offset=".5" stop-color="${cloudC}" stop-opacity=".16"/><stop offset="1" stop-color="${bottom}" stop-opacity="0"/></radialGradient>
 <linearGradient id="cloud" x1="0" y1="60" x2="288" y2="96" gradientUnits="userSpaceOnUse"><stop stop-color="${cloudA}" stop-opacity=".5"/><stop offset=".52" stop-color="${cloudB}" stop-opacity=".62"/><stop offset="1" stop-color="${cloudC}" stop-opacity=".5"/></linearGradient>
 <radialGradient id="flash" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(186 34) scale(88 54)"><stop stop-color="#e4eaff" stop-opacity=".38"/><stop offset="1" stop-color="#e4eaff" stop-opacity="0"/></radialGradient>
 <filter id="soft" x="-24" y="-24" width="336" height="144" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="4"/></filter>
 <filter id="haze" x="-24" y="-24" width="336" height="144" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="9"/></filter>
 <mask id="crescent"><circle cx="${orbX}" cy="${orbY}" r="${orbR}" fill="#fff"/><circle cx="${orbX - 5}" cy="${orbY - 3.5}" r="${orbR - 0.5}" fill="#000"/></mask>
</defs>
<rect width="288" height="96" fill="url(#sky)"/>
<rect width="288" height="96" fill="url(#glow)"/>
${starOpacity ? `<g opacity="${starOpacity}">${starField}</g>` : ""}
${orb}
${weather === "storm" ? lightning : ""}
<g filter="url(#${misty ? "haze" : "soft"})" fill="url(#cloud)">${decks[weather].map(([path, move, opacity]) => `<path d="${path}" transform="${move}" fill-opacity="${opacity}"/>`).join("")}</g>
${misty ? `<g filter="url(#haze)" fill="${cloudA}"><ellipse cx="60" cy="44" rx="130" ry="9" opacity=".3"/><ellipse cx="210" cy="62" rx="140" ry="10" opacity=".34"/><ellipse cx="96" cy="80" rx="150" ry="11" opacity=".36"/></g>` : ""}
${weather === "rain" || weather === "snow" || weather === "storm" ? precipitation(weather, cloudA) : ""}
</svg>`;
}

const imageCache = new Map<string, string>();
export function skyArtworkImage(phase: SkyPhase, weather: SkyWeather): string {
  const key = `${phase}-${weather}`;
  let image = imageCache.get(key);
  if (!image) {
    image = `data:image/svg+xml,${encodeURIComponent(skyArtworkSvg(phase, weather))}`;
    imageCache.set(key, image);
  }
  return image;
}

/**
 * App icons are the shipped MT tile repainted, never a redrawn lookalike: its
 * artwork, gloss and mark stay exactly as they ship and only the colour moves.
 * Each tone of the tile is mapped onto the scene's own palette, so the icon
 * carries the same colours as that sky rather than an arbitrary hue shift.
 *
 * Six evenly spaced stops from the darkest sky to white; white keeps the mark
 * and the rim gloss at full value.
 */
const mix = (from: string, to: string, amount: number) =>
  `#${[1, 3, 5]
    .map((at) => {
      const a = Number.parseInt(from.slice(at, at + 2), 16);
      const b = Number.parseInt(to.slice(at, at + 2), 16);
      return Math.round(a + (b - a) * amount)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;

/**
 * How much cloud the scene shows. The tile's cloud banks cannot be removed, so
 * coverage is carried by their value: a cloudy sky lifts them toward white, a
 * clear one lets them sink back into the sky.
 */
const cloudLift: Record<SkyWeather, number> = {
  clear: -0.34,
  cloudy: 0.26,
  rain: -0.05,
  snow: 0.3,
  fog: 0.12,
  storm: -0.08,
};

/**
 * Where each palette colour sits on the tile's tonal range. The sky colours are
 * packed low and the cloud colours hold the middle, because the tile's cloud
 * banks sit around half luminance: spacing the stops evenly instead drags a
 * dark sky colour across them and the banks go muddy.
 */
const RAMP_POSITIONS = [0, 0.12, 0.26, 0.52, 0.74, 1] as const;

/** The mark's outline sits near 0.89; the sky stays clear of it. */
const SKY_CEILING = 0.76;

const luminance = (color: string) =>
  (Number.parseInt(color.slice(1, 3), 16) * 0.2126 +
    Number.parseInt(color.slice(3, 5), 16) * 0.7152 +
    Number.parseInt(color.slice(5, 7), 16) * 0.0722) /
  255;

export function skyIconRamp(phase: SkyPhase, weather: SkyWeather): readonly string[] | null {
  // The shipped tile already is a cloudy night, so that scene ships untouched.
  if (phase === "night" && weather === "cloudy") return null;
  const [rawBottom, mid, top, , cloudA, cloudB] = scenes[phase][weather];
  // The mark's drop shadow is only a little darker than the tile's night sky.
  // A bright scene would drop it all the way to that scene's darkest colour,
  // which reads as a hole punched round the mark, so the floor rises with the
  // sky: no change at night, most of the way to the mid tone at midday.
  const floor = Math.min(0.65, Math.max(0, (luminance(mid) - 0.12) * 1.5));
  const bottom = mix(rawBottom, mid, floor);
  // Night keeps one cloud treatment across its weather so the whole row reads
  // as the same sky the default icon shows.
  const lift = phase === "night" ? cloudLift.cloudy : cloudLift[weather];
  // Sinking clouds means pulling them toward the body of the sky, never toward
  // its lit horizon, which would only make them brighter.
  const toward = lift > 0 ? "#ffffff" : mid;
  const amount = Math.abs(lift);
  // Ordered by their own brightness, never by their role in the sky. A dusk or
  // midday palette can have a lit horizon brighter than its clouds, and out of
  // order those stops invert the tile's own shading: a shadow lands lighter
  // than what it falls on, which is what makes the mark look cut out.
  const stops = [bottom, mid, top, mix(cloudB, toward, amount), mix(cloudA, toward, amount)];
  return [
    ...stops
      .sort((a, b) => luminance(a) - luminance(b))
      // Nothing in the sky may outshine the mark's outline. A bright palette
      // otherwise lifts the tile's clouds past it, the outline stops reading as
      // the lighter edge it is, and the mark ends up drawn in dashes.
      .map((color) => {
        const level = luminance(color);
        return level <= SKY_CEILING ? color : mix("#000000", color, SKY_CEILING / level);
      }),
    "#ffffff",
  ];
}

/** The ramp colour for a 0..1 tone, honouring where each stop sits. */
export function sampleSkyRamp(ramp: readonly string[], level: number): string {
  const last = ramp.length - 1;
  let index = 0;
  while (index < last - 1 && level > RAMP_POSITIONS[index + 1]!) index++;
  const from = RAMP_POSITIONS[index]!;
  const span = RAMP_POSITIONS[index + 1]! - from;
  return mix(ramp[index]!, ramp[index + 1]!, Math.min(1, Math.max(0, (level - from) / span)));
}

const RAMP_SAMPLES = 64;

/** Evenly spaced channel tables for an SVG `feComponentTransfer`. */
export const skyIconTables = (phase: SkyPhase, weather: SkyWeather) => {
  const ramp = skyIconRamp(phase, weather);
  if (ramp === null) return null;
  const samples = Array.from({ length: RAMP_SAMPLES }, (_, index) =>
    sampleSkyRamp(ramp, index / (RAMP_SAMPLES - 1)),
  );
  return [0, 1, 2].map((offset) =>
    samples
      .map((color) =>
        (Number.parseInt(color.slice(1 + offset * 2, 3 + offset * 2), 16) / 255).toFixed(4),
      )
      .join(" "),
  );
};

// The shipped tile is a squircle inset in its 1024 canvas; weather stays inside it.
const ICON_SHAPE = { x: 104, y: 104, size: 816, radius: 190 };

const iconStrike = trace(filament(11, 620, 150, 760));

/**
 * The tile's stars and sparkles, as [x, y, radius, the tone of what they sit
 * on]. Daylight and overcast skies have none, so they are painted out with
 * whatever that spot repaints to; a clear or lightly clouded sky keeps them.
 */
export const TILE_STARS: ReadonlyArray<readonly [number, number, number, number]> = [
  [159, 547, 2, 0.194],
  [204, 207, 4, 0.079],
  [295, 239, 4, 0.102],
  [445, 182, 4, 0.1],
  [850, 364, 3, 0.534],
  [856, 664, 3, 0.105],
];

export const skyHidesStars = (phase: SkyPhase, weather: SkyWeather) =>
  phase === "day" || (weather !== "clear" && weather !== "cloudy");

/** Transparent 1024 overlay: what a repaint alone cannot say. */
export function skyIconOverlaySvg(phase: SkyPhase, weather: SkyWeather): string {
  const tint = scenes[phase][weather][4];
  // night/cloudy ships untouched, so borrow the clear night's ramp to colour
  // anything the overlay needs to paint over.
  const ramp = skyIconRamp(phase, weather) ?? skyIconRamp("night", "clear")!;
  let body = skyHidesStars(phase, weather)
    ? `<g filter="url(#iconBlur2)">${TILE_STARS.map(([x, y, radius, level]) => `<circle cx="${x}" cy="${y}" r="${radius + 7}" fill="${sampleSkyRamp(ramp, level)}"/>`).join("")}</g>`
    : "";
  if (weather === "rain" || weather === "snow" || weather === "storm") {
    const count = weather === "storm" ? 46 : weather === "rain" ? 40 : 34;
    body += Array.from({ length: count }, (_, index) => {
      const x = (ICON_SHAPE.x + noise(index + 5) * ICON_SHAPE.size).toFixed(0);
      const y = (ICON_SHAPE.y + noise(index + 61) * ICON_SHAPE.size).toFixed(0);
      const fade = (0.3 + noise(index + 13) * 0.35).toFixed(2);
      if (weather === "snow")
        return `<circle cx="${x}" cy="${y}" r="${(5 + noise(index + 29) * 7).toFixed(1)}" fill="#f2f6ff" opacity="${fade}"/>`;
      const storm = weather === "storm";
      return `<path d="M${x} ${y}l${storm ? -22 : -14} ${(storm ? 58 : 42) + noise(index + 37) * 26}" stroke="${tint}" stroke-width="${storm ? 6 : 5}" stroke-linecap="round" opacity="${fade}"/>`;
    }).join("");
  }
  if (weather === "storm")
    body +=
      `<ellipse cx="620" cy="360" rx="330" ry="330" fill="url(#iconFlash)"/><g fill="none" stroke="#eaf0ff" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#iconBlur)" opacity=".45"><path d="${iconStrike}" stroke-width="26"/></g><path d="${iconStrike}" stroke-width="7" opacity=".95"/></g>` +
      body;
  if (weather === "fog")
    body += `<g filter="url(#iconBlur)" fill="${tint}"><ellipse cx="380" cy="470" rx="520" ry="52" opacity=".4"/><ellipse cx="640" cy="640" rx="540" ry="58" opacity=".46"/><ellipse cx="420" cy="810" rx="520" ry="54" opacity=".42"/></g>`;
  if (body === "") return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
<defs>
 <clipPath id="iconShape"><rect x="${ICON_SHAPE.x}" y="${ICON_SHAPE.y}" width="${ICON_SHAPE.size}" height="${ICON_SHAPE.size}" rx="${ICON_SHAPE.radius}"/></clipPath>
 <radialGradient id="iconFlash" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(620 360) scale(330)"><stop stop-color="#e4eaff" stop-opacity=".3"/><stop offset="1" stop-color="#e4eaff" stop-opacity="0"/></radialGradient>
 <filter id="iconBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="26"/></filter>
 <filter id="iconBlur2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>
<g clip-path="url(#iconShape)">${body}</g>
</svg>`;
}

const overlayCache = new Map<string, string>();
export function skyIconOverlayImage(phase: SkyPhase, weather: SkyWeather): string {
  const key = `${phase}-${weather}`;
  let image = overlayCache.get(key);
  if (image === undefined) {
    const svg = skyIconOverlaySvg(phase, weather);
    image = svg === "" ? "" : `data:image/svg+xml,${encodeURIComponent(svg)}`;
    overlayCache.set(key, image);
  }
  return image;
}
