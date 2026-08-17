import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DesktopDistroId = "default" | "munim";

export interface RuntimeDesktopDistro {
  readonly id: DesktopDistroId;
  readonly baseName: string;
  readonly userDataDirName: string;
  readonly legacyUserDataDirName: string;
  readonly defaultHomeDirName: string;
  readonly appUserModelId: string;
  readonly linuxDesktopEntryName: string;
  readonly linuxWmClass: string;
}

function readPackagedDistro(appPath: string | undefined): DesktopDistroId | null {
  if (!appPath) return null;
  try {
    const raw = readFileSync(join(appPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { t3DesktopDistro?: string };
    if (pkg.t3DesktopDistro === "munim") return "munim";
  } catch {
    // unpackaged / missing
  }
  return null;
}

export function resolveRuntimeDesktopDistroId(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly appPath?: string | undefined;
  readonly isDevelopment: boolean;
}): DesktopDistroId {
  if (input.env.T3CODE_DESKTOP_DISTRO?.trim() === "munim") return "munim";
  if (!input.isDevelopment) {
    const packaged = readPackagedDistro(input.appPath);
    if (packaged) return packaged;
  }
  return "default";
}

export function resolveRuntimeDesktopDistro(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly appPath?: string | undefined;
  readonly isDevelopment: boolean;
}): RuntimeDesktopDistro {
  const id = resolveRuntimeDesktopDistroId(input);
  if (id === "munim") {
    return {
      id,
      baseName: "T3 Code Munim",
      userDataDirName: input.isDevelopment ? "t3code-munim-dev" : "t3code-munim",
      legacyUserDataDirName: input.isDevelopment ? "T3 Code Munim (Dev)" : "T3 Code Munim (Alpha)",
      defaultHomeDirName: ".t3-munim",
      appUserModelId: input.isDevelopment ? "com.munim.t3code.dev" : "com.munim.t3code",
      linuxDesktopEntryName: input.isDevelopment
        ? "t3code-munim-dev.desktop"
        : "t3code-munim.desktop",
      linuxWmClass: input.isDevelopment ? "t3code-munim-dev" : "t3code-munim",
    };
  }
  return {
    id,
    baseName: "T3 Code",
    userDataDirName: input.isDevelopment ? "t3code-dev" : "t3code",
    legacyUserDataDirName: input.isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)",
    defaultHomeDirName: ".t3",
    appUserModelId: input.isDevelopment ? "com.t3tools.t3code.dev" : "com.t3tools.t3code",
    linuxDesktopEntryName: input.isDevelopment ? "t3code-dev.desktop" : "t3code.desktop",
    linuxWmClass: input.isDevelopment ? "t3code-dev" : "t3code",
  };
}
