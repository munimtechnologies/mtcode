import Constants from "expo-constants";

export type MobileDistroId = "default" | "munim";

type BrandingExtra = {
  readonly distroId?: unknown;
  readonly productName?: unknown;
  readonly connectProductName?: unknown;
  readonly scheme?: unknown;
  readonly schemeDev?: unknown;
  readonly schemePreview?: unknown;
};

function brandingExtra(): BrandingExtra {
  const extra = Constants.expoConfig?.extra;
  if (!extra || typeof extra !== "object") return {};
  return (extra as { branding?: BrandingExtra }).branding ?? {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Active mobile distro. Defaults to official T3 when unset (tests / old binaries). */
export function getDistroId(): MobileDistroId {
  return brandingExtra().distroId === "munim" ? "munim" : "default";
}

export function isMunimDistro(): boolean {
  return getDistroId() === "munim";
}

/** Product name shown in UI ("MT Code" / "T3 Code"). */
export function getProductName(): string {
  return (
    readString(brandingExtra().productName) ??
    readString(Constants.expoConfig?.name)?.replace(/\s+(Dev|Preview)$/, "") ??
    "MT Code"
  );
}

/** Connect product name ("MT Connect" / "T3 Connect"). */
export function getConnectName(): string {
  return (
    readString(brandingExtra().connectProductName) ?? `${getProductName().split(" ")[0]} Connect`
  );
}

/** Auth / pairing client label sent to the environment. */
export function getMobileClientLabel(): string {
  return `${getProductName()} Mobile`;
}

/** Production deep-link scheme for this distro. */
export function getAppScheme(): string {
  return readString(brandingExtra().scheme) ?? (isMunimDistro() ? "mtcode" : "t3code");
}

export function getAppSchemeDev(): string {
  return readString(brandingExtra().schemeDev) ?? `${getAppScheme()}-dev`;
}

export function getAppSchemePreview(): string {
  return readString(brandingExtra().schemePreview) ?? `${getAppScheme()}-preview`;
}

/** First word of the product name for wordmark slots ("MT" / "T3"). */
export function getBrandMark(): string {
  return getProductName().split(" ")[0] ?? "T3";
}

/** Remaining words after the mark ("Code"). */
export function getBrandLabel(): string {
  const parts = getProductName().split(" ");
  return parts.slice(1).join(" ") || "Code";
}
