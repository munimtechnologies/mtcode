import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import {
  desktopMcpPathOverride,
  MUNIM_COMPUTER_USE_RESOURCE_DIR,
  munimComputerUseAssetKey,
  munimComputerUseCacheDir,
  munimComputerUseCheckoutBinaries,
  munimComputerUseExecutableName,
  parseMunimComputerUseManifest,
  type MunimComputerUsePlatform,
} from "@t3tools/shared/munimComputerUse";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/**
 * Locate the desktop-control MCP server: the munim-computer-use binary, run by
 * MT Code under its own identity and registered as `mt-desktop`.
 *
 * Order: `MTCODE_DESKTOP_MCP_PATH` (then the deprecated `T3CODE_DESKTOP_MCP_PATH`),
 * the copy packaged into the app's Resources, a local munim-computer-use
 * checkout's build (`$MUNIM_COMPUTER_USE_CHECKOUT`, default `~/computer-use`),
 * and finally the release the desktop build fetched into the cache for the
 * version pinned in `native/munim-computer-use.json`. Resolves to undefined
 * when none exists — callers treat that as "do not offer the tools".
 */
export const resolveDesktopMcpPath = Effect.fn("desktopControl.resolveDesktopMcpPath")(
  function* () {
    const platform = yield* HostProcessPlatform;
    if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
      return undefined;
    }

    const environment = yield* HostProcessEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const executableName = munimComputerUseExecutableName(platform);

    const override = desktopMcpPathOverride(environment);

    const packaged = [
      // Packaged: staged into app Resources beside the server bundle.
      path.resolve(import.meta.dirname, MUNIM_COMPUTER_USE_RESOURCE_DIR, executableName),
      path.resolve(import.meta.dirname, "..", MUNIM_COMPUTER_USE_RESOURCE_DIR, executableName),
    ];

    const home = environment.HOME ?? environment.USERPROFILE;
    const checkout =
      environment.MUNIM_COMPUTER_USE_CHECKOUT?.trim() ||
      (home ? path.join(home, "computer-use") : undefined);
    const checkoutBuilds = checkout
      ? munimComputerUseCheckoutBinaries(platform).map((parts) => path.join(checkout, ...parts))
      : [];

    const cached = yield* fetchedReleaseBinary({ platform, environment, home, path, fileSystem });

    const candidates = [
      ...(override ? [override] : []),
      ...packaged,
      ...checkoutBuilds,
      ...(cached ? [cached] : []),
    ];

    for (const candidate of candidates) {
      if (yield* isRunnable(fileSystem, platform, candidate)) {
        return candidate;
      }
    }
    return undefined;
  },
);

/** The binary the desktop build fetched for the pinned release, if any (dev only). */
const fetchedReleaseBinary = Effect.fn("desktopControl.fetchedReleaseBinary")(function* (input: {
  readonly platform: MunimComputerUsePlatform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly home: string | undefined;
  readonly path: Path.Path;
  readonly fileSystem: FileSystem.FileSystem;
}) {
  if (!input.home) return undefined;
  // Only a checkout has the manifest; a packaged server never reaches here.
  const manifestPath = input.path.resolve(
    import.meta.dirname,
    "../../../../native/munim-computer-use.json",
  );
  const text = yield* input.fileSystem
    .readFileString(manifestPath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (text === undefined) return undefined;
  const manifest = yield* Effect.try(() => parseMunimComputerUseManifest(text)).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  if (manifest === undefined) return undefined;
  const version = manifest.version;
  const arch = yield* HostProcessArchitecture;
  const key = munimComputerUseAssetKey(input.platform, arch === "arm64" ? "arm64" : "x64");
  const dir = munimComputerUseCacheDir({
    environment: input.environment,
    homeDir: input.home,
    version,
    key,
    join: (...parts) => input.path.join(...parts),
  });
  return input.path.join(dir, munimComputerUseExecutableName(input.platform));
});

const isRunnable = Effect.fn("desktopControl.isRunnable")(function* (
  fileSystem: FileSystem.FileSystem,
  platform: MunimComputerUsePlatform,
  candidate: string,
) {
  const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return false;
  const stat = yield* fileSystem.stat(candidate).pipe(Effect.option);
  if (Option.isNone(stat) || stat.value.type !== "File") return false;
  // Windows does not use POSIX execute bits the same way; existence of a
  // regular file is enough. On POSIX, skip non-executable paths so a bad
  // override does not block a valid packaged binary.
  return platform === "win32" || (stat.value.mode & 0o111) !== 0;
});
