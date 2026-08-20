/**
 * Public Munim distribution identity for personal-fork mobile builds.
 *
 * Set T3CODE_MOBILE_DISTRO=munim (or T3CODE_DESKTOP_DISTRO=munim) when packaging
 * MT Code for munimtech.com. Default (unset) keeps the official T3 Code identity.
 */

export type MobileDistroId = "default" | "munim";

export interface MobileDistroIdentity {
  readonly id: MobileDistroId;
  readonly productName: string;
  readonly scheme: string;
  readonly schemeDev: string;
  readonly schemePreview: string;
  readonly iosBundleIdentifier: string;
  readonly iosBundleIdentifierDev: string;
  readonly iosBundleIdentifierPreview: string;
  readonly androidPackage: string;
  readonly androidPackageDev: string;
  readonly androidPackagePreview: string;
  readonly slug: string;
  readonly appleTeamId: string;
  readonly clerkRelyingParty: string;
  readonly hostedAppDomain: string | undefined;
  readonly easProjectId: string | undefined;
  readonly expoOwner: string | undefined;
}

const T3_EAS_PROJECT_ID = "d763fcb8-d37c-41ea-a773-b54a0ab4a454";

const OFFICIAL: MobileDistroIdentity = {
  id: "default",
  productName: "T3 Code",
  scheme: "t3code",
  schemeDev: "t3code-dev",
  schemePreview: "t3code-preview",
  iosBundleIdentifier: "com.t3tools.t3code",
  iosBundleIdentifierDev: "com.t3tools.t3code.dev",
  iosBundleIdentifierPreview: "com.t3tools.t3code.preview",
  androidPackage: "com.t3tools.t3code",
  androidPackageDev: "com.t3tools.t3code.dev",
  androidPackagePreview: "com.t3tools.t3code.preview",
  slug: "t3-code",
  appleTeamId: "ARK85ZXQ4Z",
  clerkRelyingParty: "clerk.t3.codes",
  hostedAppDomain: undefined,
  easProjectId: T3_EAS_PROJECT_ID,
  expoOwner: "pingdotgg",
};

const MUNIM: MobileDistroIdentity = {
  id: "munim",
  productName: "MT Code",
  scheme: "mtcode",
  schemeDev: "mtcode-dev",
  schemePreview: "mtcode-preview",
  iosBundleIdentifier: "com.munim.mtcode",
  iosBundleIdentifierDev: "com.munim.mtcode.dev",
  iosBundleIdentifierPreview: "com.munim.mtcode.preview",
  androidPackage: "com.munim.mtcode",
  androidPackageDev: "com.munim.mtcode.dev",
  androidPackagePreview: "com.munim.mtcode.preview",
  slug: "mt-code",
  appleTeamId: "6T5J6U2UVT",
  clerkRelyingParty: "clerk.mtcode.munimtech.com",
  hostedAppDomain: "mtcode.munimtech.com",
  // @munimtechnologies/mt-code
  easProjectId: "0c4e70dd-ce27-4669-aba1-d1e5a683fbbf",
  expoOwner: "munimtechnologies",
};

export function resolveMobileDistroRaw(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const mobile = env.T3CODE_MOBILE_DISTRO?.trim();
  if (mobile) {
    return mobile;
  }
  return env.T3CODE_DESKTOP_DISTRO?.trim() || undefined;
}

export function resolveMobileDistroId(
  raw: string | undefined | null = resolveMobileDistroRaw(),
): MobileDistroId {
  return raw === "munim" ? "munim" : "default";
}

export function resolveMobileDistroIdentity(
  raw: string | undefined | null = resolveMobileDistroRaw(),
): MobileDistroIdentity {
  return resolveMobileDistroId(raw) === "munim" ? MUNIM : OFFICIAL;
}

export function resolveMobileUpdatesUrl(distro: MobileDistroIdentity): string | undefined {
  if (!distro.easProjectId) {
    return undefined;
  }
  return `https://u.expo.dev/${distro.easProjectId}`;
}
