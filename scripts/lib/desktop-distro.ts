/**
 * Public Munim distribution identity for personal-fork desktop builds.
 *
 * Set T3CODE_DESKTOP_DISTRO=munim when packaging installers for munimtech.com.
 * Default (unset) keeps the official T3 Code identity for the private SSH fleet.
 */

export type DesktopDistroId = "default" | "munim";

export interface DesktopDistroIdentity {
  readonly id: DesktopDistroId;
  readonly appId: string;
  readonly productName: string;
  readonly packageName: string;
  readonly artifactName: string;
  readonly description: string;
  readonly author: string;
  readonly updateRepository: string | undefined;
  readonly protocolSchemes: readonly string[];
  readonly protocolName: string;
  readonly linuxExecutableName: string;
  readonly linuxStartupWmClass: string;
  readonly nsisShortcutName: string;
  readonly nsisInstallDirectoryName: string;
}

const OFFICIAL: DesktopDistroIdentity = {
  id: "default",
  appId: "com.t3tools.t3code",
  productName: "T3 Code",
  packageName: "t3code",
  artifactName: "T3-Code-${version}-${arch}.${ext}",
  description: "T3 Code desktop build",
  author: "T3 Tools",
  updateRepository: undefined,
  protocolSchemes: ["t3code", "t3code-dev"],
  protocolName: "T3 Code",
  linuxExecutableName: "t3code",
  linuxStartupWmClass: "t3code",
  nsisShortcutName: "T3 Code",
  nsisInstallDirectoryName: "t3code",
};

const MUNIM: DesktopDistroIdentity = {
  id: "munim",
  appId: "com.munim.mtcode",
  productName: "MT Code",
  packageName: "mtcode",
  artifactName: "MT-Code-${version}-${arch}.${ext}",
  description: "MT Code — Munim Technologies fork of T3 Code",
  author: "Munim Technologies",
  updateRepository: "sheehanmunim/t3code",
  protocolSchemes: ["mtcode", "mtcode-dev"],
  protocolName: "MT Code",
  linuxExecutableName: "mtcode",
  linuxStartupWmClass: "mtcode",
  nsisShortcutName: "MT Code",
  nsisInstallDirectoryName: "mtcode",
};

export function resolveDesktopDistroId(
  raw: string | undefined | null = process.env.T3CODE_DESKTOP_DISTRO,
): DesktopDistroId {
  return raw?.trim() === "munim" ? "munim" : "default";
}

export function resolveDesktopDistroIdentity(
  raw: string | undefined | null = process.env.T3CODE_DESKTOP_DISTRO,
): DesktopDistroIdentity {
  return resolveDesktopDistroId(raw) === "munim" ? MUNIM : OFFICIAL;
}
