import { useAtomValue } from "@effect/atom-react";
import { useId } from "react";

import { APP_HAS_UPDATE_TRACKS, APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";
import { usePrimarySettings } from "../hooks/useSettings";

export type SidebarStageBackdropVariant =
  | { readonly kind: "nightly" }
  | { readonly kind: "dev" }
  | { readonly kind: "custom"; readonly image: string; readonly name: string };
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

export const NIGHTLY_BACKDROP: SidebarStageBackdropVariant = { kind: "nightly" };
export const DEV_BACKDROP: SidebarStageBackdropVariant = { kind: "dev" };

/**
 * Resolve the artwork to draw from the account's choice.
 *
 * "auto" defers to the build channel the way upstream does; every other value
 * is a deliberate pick and ignores the channel entirely, which is the point on
 * a single-release build like MT Code.
 */
export function resolveSidebarArtwork(input: {
  readonly selection: string;
  readonly stageLabel: string;
  readonly custom: ReadonlyArray<{ readonly id: string; readonly name: string; readonly image: string }>;
  readonly enabled?: boolean;
}): SidebarStageBackdropVariant | null {
  if (input.enabled === false) return null;
  const selection = input.selection.trim();
  if (selection === "none") return null;
  if (selection === "night") return NIGHTLY_BACKDROP;
  if (selection === "day") return DEV_BACKDROP;
  if (selection !== "auto" && selection.length > 0) {
    const artwork = input.custom.find((entry) => entry.id === selection);
    // A deleted artwork leaves the header bare rather than silently falling
    // back to a scene the user did not choose.
    return artwork ? { kind: "custom", image: artwork.image, name: artwork.name } : null;
  }
  return resolveSidebarStageBackdropVariant(input.stageLabel);
}

// A wide viewBox keeps the 96-unit art height at a fixed scale while sidebar resizing reveals
// more horizontal canvas instead of zooming the scene.
const STAGE_BACKDROP_VIEW_BOX = "0 0 8192 96";

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  enabled = true,
): SidebarStageBackdropVariant | null {
  if (!enabled) return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return NIGHTLY_BACKDROP;
  if (normalized === "dev") return DEV_BACKDROP;
  return null;
}

export function resolveSidebarStageFocusRingOffsetClass(
  variant: SidebarStageBackdropVariant,
): string {
  return variant.kind === "nightly"
    ? "focus-visible:ring-offset-(--stage-night-bottom)"
    : "focus-visible:ring-offset-(--stage-art-bottom)";
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
    allowNightlyStage: APP_HAS_UPDATE_TRACKS,
  });
}

export function useSidebarStageBackdropVariant(enabled = true): SidebarStageBackdropVariant | null {
  const stageLabel = useEnvironmentStageLabel();
  const artwork = usePrimarySettings((settings) => ({
    selection: settings.sidebarArtwork,
    custom: settings.customSidebarArtworks,
  }));
  return resolveSidebarArtwork({
    selection: artwork.selection,
    stageLabel,
    custom: artwork.custom,
    enabled,
  });
}

/** Stage-channel header art; palettes mirror the per-channel app icons in `assets/`. */
export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <StageBackdropArt variant={variant} />
    </div>
  );
}

export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  if (variant.kind === "custom") return <CustomArt variant={variant} />;
  return variant.kind === "nightly" ? <NightlySkyArt /> : <DevBlueprintArt />;
}

export function StageBackdropButtonArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  if (variant.kind === "custom") return <CustomArt variant={variant} />;
  return variant.kind === "nightly" ? <NightlySkyArt compact /> : <DevBlueprintArt compact />;
}

/**
 * A user's own artwork. Drawn as a cover-cropped band so any aspect ratio
 * fills the header the way the built-in scenes do.
 */
function CustomArt({
  variant,
}: {
  variant: Extract<SidebarStageBackdropVariant, { kind: "custom" }>;
}) {
  return (
    <div
      role="img"
      aria-label={variant.name}
      className="stage-art h-full w-full bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${JSON.stringify(variant.image)})` }}
    />
  );
}

const NIGHTLY_STARS: ReadonlyArray<{
  cx: number;
  cy: number;
  r: number;
  opacity: number;
}> = [
  { cx: 14, cy: 10, r: 0.6, opacity: 0.85 },
  { cx: 38, cy: 22, r: 0.4, opacity: 0.55 },
  { cx: 58, cy: 8, r: 0.5, opacity: 0.7 },
  { cx: 84, cy: 16, r: 0.4, opacity: 0.5 },
  { cx: 104, cy: 7, r: 0.6, opacity: 0.8 },
  { cx: 126, cy: 20, r: 0.4, opacity: 0.55 },
  { cx: 148, cy: 11, r: 0.5, opacity: 0.7 },
  { cx: 170, cy: 24, r: 0.4, opacity: 0.5 },
  { cx: 192, cy: 9, r: 0.6, opacity: 0.8 },
  { cx: 214, cy: 18, r: 0.4, opacity: 0.55 },
  { cx: 236, cy: 8, r: 0.5, opacity: 0.7 },
  { cx: 258, cy: 20, r: 0.45, opacity: 0.6 },
  { cx: 278, cy: 11, r: 0.55, opacity: 0.75 },
  { cx: 26, cy: 34, r: 0.4, opacity: 0.45 },
  { cx: 118, cy: 34, r: 0.4, opacity: 0.45 },
  { cx: 202, cy: 32, r: 0.4, opacity: 0.5 },
  { cx: 268, cy: 34, r: 0.4, opacity: 0.45 },
];

const NIGHTLY_SPARKLES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 70, y: 28 },
  { x: 160, y: 36 },
  { x: 246, y: 26 },
];

function NightlySkyArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const skyId = `${idPrefix}-stage-night-sky`;
  const glowId = `${idPrefix}-stage-night-glow`;
  const cloudId = `${idPrefix}-stage-night-cloud`;
  const softId = `${idPrefix}-stage-night-soft`;
  const starsId = `${idPrefix}-stage-night-stars`;
  const glowsId = `${idPrefix}-stage-night-glows`;

  return (
    <svg
      className="stage-art stage-nightly h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "96 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={skyId}
          x1="24"
          y1="0"
          x2="264"
          y2="96"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={{ stopColor: "var(--stage-night-bottom)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stage-night-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--stage-night-top)" }} />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(216 18) rotate(137) scale(120 84)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: "var(--stage-night-glow-highlight)" }} stopOpacity="0.4" />
          <stop
            offset="0.5"
            style={{ stopColor: "var(--stage-night-glow-secondary)" }}
            stopOpacity="0.16"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-night-bottom)" }} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={cloudId} x1="0" y1="60" x2="288" y2="96" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: "var(--stage-night-highlight)" }} stopOpacity="0.5" />
          <stop
            offset="0.52"
            style={{ stopColor: "var(--stage-night-secondary)" }}
            stopOpacity="0.62"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-night-tertiary)" }} stopOpacity="0.5" />
        </linearGradient>
        <filter id={softId} x="-24" y="-24" width="336" height="144" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <pattern id={starsId} width="288" height="96" patternUnits="userSpaceOnUse">
          <g style={{ fill: "var(--stage-night-line)" }}>
            {NIGHTLY_STARS.map((star) => (
              <circle
                key={`${star.cx}-${star.cy}`}
                cx={star.cx}
                cy={star.cy}
                r={star.r}
                fillOpacity={star.opacity}
              />
            ))}
          </g>
          <g
            style={{ stroke: "var(--stage-night-sparkle)" }}
            strokeLinecap="round"
            strokeOpacity="0.7"
            strokeWidth="0.6"
          >
            {NIGHTLY_SPARKLES.map((sparkle) => (
              <g key={`${sparkle.x}-${sparkle.y}`}>
                <path d={`M${sparkle.x - 1.5} ${sparkle.y}H${sparkle.x + 1.5}`} />
                <path d={`M${sparkle.x} ${sparkle.y - 1.5}V${sparkle.y + 1.5}`} />
              </g>
            ))}
          </g>
        </pattern>
        <pattern id={glowsId} width="640" height="96" patternUnits="userSpaceOnUse">
          <rect width="640" height="96" fill={`url(#${glowId})`} />
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${skyId})`} />
      <rect width="100%" height="96" fill={`url(#${glowsId})`} />
      <rect width="100%" height="96" fill={`url(#${starsId})`} />

      <g filter={`url(#${softId})`}>
        <path
          d="M-12 88C-12 74 0 63 14 63C18 50 30 41 44 41C58 41 70 49 74 62C79 57 86 54 94 54C110 54 123 66 124 82C132 83 138 88 141 96H-12V88Z"
          fill={`url(#${cloudId})`}
        />
      </g>
      <g filter={`url(#${softId})`}>
        <path
          d="M150 96C151 84 161 75 173 75C176 64 186 57 198 57C210 57 220 64 223 75C231 75 238 80 241 87C250 87 257 91 260 96H150Z"
          fill={`url(#${cloudId})`}
          fillOpacity="0.8"
        />
      </g>
    </svg>
  );
}

function DevBlueprintArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const paperId = `${idPrefix}-stage-bp-paper`;
  const glowId = `${idPrefix}-stage-bp-glow`;
  const celesteGlowId = `${idPrefix}-stage-bp-glow-celeste`;
  const violetGlowId = `${idPrefix}-stage-bp-glow-violet`;
  const minorGridId = `${idPrefix}-stage-bp-grid-minor`;
  const majorGridId = `${idPrefix}-stage-bp-grid-major`;
  const rulerId = `${idPrefix}-stage-bp-ruler`;
  const glowsId = `${idPrefix}-stage-bp-glows`;
  const annotationsId = `${idPrefix}-stage-bp-annotations`;

  return (
    <svg
      className="stage-art stage-blueprint h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "64 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={paperId}
          x1="60"
          y1="0"
          x2="220"
          y2="96"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={{ stopColor: "var(--stage-art-bottom)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stage-art-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--stage-art-top)" }} />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(216 14) rotate(137) scale(120 84)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: "var(--stage-art-highlight)" }} stopOpacity="0.4" />
          <stop
            offset="0.52"
            style={{ stopColor: "var(--stage-art-secondary)" }}
            stopOpacity="0.16"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-art-bottom)" }} stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={celesteGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(474 44) rotate(166) scale(156 92)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: "var(--stage-art-celeste-highlight)" }} stopOpacity="0.34" />
          <stop
            offset="0.5"
            style={{ stopColor: "var(--stage-art-celeste-secondary)" }}
            stopOpacity="0.18"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-art-bottom)" }} stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={violetGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(704 18) rotate(145) scale(132 88)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: "var(--stage-art-violet-highlight)" }} stopOpacity="0.3" />
          <stop
            offset="0.52"
            style={{ stopColor: "var(--stage-art-tertiary)" }}
            stopOpacity="0.14"
          />
          <stop offset="1" style={{ stopColor: "var(--stage-art-bottom)" }} stopOpacity="0" />
        </radialGradient>
        <pattern id={minorGridId} width="8" height="8" patternUnits="userSpaceOnUse">
          <path
            d="M8 0H0V8"
            style={{ stroke: "var(--stage-art-grid-line)" }}
            strokeOpacity="0.14"
            strokeWidth="0.5"
          />
        </pattern>
        <pattern id={majorGridId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path
            d="M32 0H0V32"
            style={{ stroke: "var(--stage-art-grid-line)" }}
            strokeOpacity="0.26"
            strokeWidth="0.6"
          />
        </pattern>
        <pattern id={rulerId} width="32" height="6" patternUnits="userSpaceOnUse">
          <path
            d="M4 0V2.5M12 0V2.5M20 0V4M28 0V2.5"
            style={{ stroke: "var(--stage-art-line)" }}
            strokeOpacity="0.5"
            strokeWidth="0.5"
          />
        </pattern>
        <pattern id={glowsId} width="768" height="96" patternUnits="userSpaceOnUse">
          <rect width="768" height="96" fill={`url(#${glowId})`} />
          <rect width="768" height="96" fill={`url(#${celesteGlowId})`} />
          <rect width="768" height="96" fill={`url(#${violetGlowId})`} />
        </pattern>
        <pattern id={annotationsId} width="768" height="96" patternUnits="userSpaceOnUse">
          <g
            style={{ stroke: "var(--stage-art-line)" }}
            strokeLinecap="round"
            strokeOpacity="0.6"
            strokeWidth="0.7"
          >
            <path d="M180 64H264" strokeDasharray="5 4" />
            <path d="M180 61V67M264 61V67" />
            <path d="M276 10V44" strokeDasharray="4 4" strokeOpacity="0.5" />
            <path d="M273 10H279M273 44H279" strokeOpacity="0.5" />
            <path d="M348 30H428" strokeDasharray="3.5 5" strokeOpacity="0.5" />
            <path d="M348 27V33M428 27V33" strokeOpacity="0.5" />
            <path d="M512 48V80" strokeDasharray="5 3" strokeOpacity="0.45" />
            <path d="M509 48H515M509 80H515" strokeOpacity="0.45" />
            <path d="M590 70H724" strokeDasharray="7 4" strokeOpacity="0.55" />
            <path d="M590 67V73M724 67V73" strokeOpacity="0.55" />
          </g>

          <g
            style={{ stroke: "var(--stage-art-line)" }}
            strokeLinecap="round"
            strokeOpacity="0.55"
            strokeWidth="0.6"
          >
            <g>
              <path d="M34 60L38 64M38 60L34 64" />
            </g>
            <g>
              <path d="M228 26H234M231 23V29" />
            </g>
            <g>
              <path d="M143 51H149M146 48V54" />
            </g>
            <g>
              <path d="M316 16L322 22M322 16L316 22" />
            </g>
            <g>
              <path d="M468 70H476M472 66V74" />
            </g>
            <g>
              <path d="M558 28L564 34M564 28L558 34" />
            </g>
            <g>
              <path d="M742 44H750M746 40V48" />
            </g>
          </g>

          <g style={{ stroke: "var(--stage-art-line)" }} strokeOpacity="0.35" strokeWidth="0.6">
            <circle cx="196" cy="38" r="13" strokeDasharray="3.5 4" />
            <path d="M196 33V43M191 38H201" strokeOpacity="0.6" strokeWidth="0.4" />
            <circle cx="414" cy="64" r="10" strokeDasharray="2.5 3.5" />
            <path d="M414 60V68M410 64H418" strokeOpacity="0.6" strokeWidth="0.4" />
            <circle cx="648" cy="32" r="15" strokeDasharray="4 5" />
            <path d="M648 26V38M642 32H654" strokeOpacity="0.6" strokeWidth="0.4" />
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${glowsId})`} />
      <rect width="100%" height="96" fill={`url(#${minorGridId})`} />
      <rect width="100%" height="96" fill={`url(#${majorGridId})`} />
      <rect width="100%" height="6" fill={`url(#${rulerId})`} />
      <rect width="100%" height="96" fill={`url(#${annotationsId})`} />
    </svg>
  );
}
