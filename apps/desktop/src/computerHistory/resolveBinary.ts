// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import {
  desktopMcpPathOverride,
  MUNIM_COMPUTER_USE_EXTENSION_DIR,
  MUNIM_COMPUTER_USE_RESOURCE_DIR,
  munimComputerUseAssetKey,
  munimComputerUseCacheDir,
  munimComputerUseCheckoutBinaries,
  munimComputerUseExecutableName,
  parseMunimComputerUseManifest,
  type MunimComputerUseAssetKey,
  type MunimComputerUsePlatform,
} from "@t3tools/shared/munimComputerUse";

const here = NodePath.dirname(fileURLToPath(import.meta.url));

function hostPlatform(): MunimComputerUsePlatform | undefined {
  const platform = process.platform;
  return platform === "darwin" || platform === "win32" || platform === "linux"
    ? platform
    : undefined;
}

/** A local munim-computer-use checkout (dev): `$MUNIM_COMPUTER_USE_CHECKOUT` or `~/computer-use`. */
function checkoutRoot(): string {
  return (
    process.env.MUNIM_COMPUTER_USE_CHECKOUT?.trim() ||
    NodePath.join(NodeOS.homedir(), "computer-use")
  );
}

/** Cache dir of the pinned release the desktop build fetched, when run from a checkout. */
function fetchedCacheDir(key: MunimComputerUseAssetKey): string | undefined {
  const candidates = [
    NodePath.resolve(here, "../../../../native/munim-computer-use.json"),
    NodePath.resolve(here, "../../../native/munim-computer-use.json"),
  ];
  for (const manifestPath of candidates) {
    try {
      const { version } = parseMunimComputerUseManifest(NodeFs.readFileSync(manifestPath, "utf8"));
      return munimComputerUseCacheDir({
        environment: process.env,
        homeDir: NodeOS.homedir(),
        version,
        key,
        join: NodePath.join,
      });
    } catch {
      // Not a checkout, or no manifest: nothing was fetched.
    }
  }
  return undefined;
}

/** `…/Resources/munim-computer-use` in a packaged app. */
function packagedDir(): string | undefined {
  return process.resourcesPath
    ? NodePath.join(process.resourcesPath, MUNIM_COMPUTER_USE_RESOURCE_DIR)
    : undefined;
}

/**
 * Locate the munim-computer-use binary for Electron main (Computer History,
 * Chrome native-host registration). Same order as the server's resolver:
 * `MTCODE_DESKTOP_MCP_PATH` (then the deprecated `T3CODE_DESKTOP_MCP_PATH`),
 * the packaged copy, a local checkout build, the fetched release.
 */
export function resolveDesktopMcpBinaryPathSync(): string | undefined {
  const platform = hostPlatform();
  if (!platform) return undefined;
  const executable = munimComputerUseExecutableName(platform);

  const override = desktopMcpPathOverride(process.env);
  const packaged = packagedDir();
  const fetched = fetchedCacheDir(
    munimComputerUseAssetKey(platform, process.arch === "arm64" ? "arm64" : "x64"),
  );
  const candidates = [
    ...(override ? [override] : []),
    ...(packaged ? [NodePath.join(packaged, executable)] : []),
    ...munimComputerUseCheckoutBinaries(platform).map((parts) =>
      NodePath.join(checkoutRoot(), ...parts),
    ),
    ...(fetched ? [NodePath.join(fetched, executable)] : []),
  ];

  for (const candidate of candidates) {
    if (NodeFs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The unpacked Chrome extension the user loads in chrome://extensions: the
 * copy packaged beside the binary, else the fetched release, else a checkout.
 */
export function resolveChromeExtensionDirSync(): string | undefined {
  const packaged = packagedDir();
  const fetched = fetchedCacheDir("chrome-extension");
  const candidates = [
    ...(packaged ? [NodePath.join(packaged, MUNIM_COMPUTER_USE_EXTENSION_DIR)] : []),
    ...(fetched ? [fetched] : []),
    NodePath.join(checkoutRoot(), MUNIM_COMPUTER_USE_EXTENSION_DIR),
  ];
  for (const candidate of candidates) {
    if (NodeFs.existsSync(NodePath.join(candidate, "manifest.json"))) return candidate;
  }
  return undefined;
}
