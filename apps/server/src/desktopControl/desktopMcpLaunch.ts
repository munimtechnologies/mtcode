/**
 * Resolves the desktop MCP binary only when Computer Use is enabled in
 * server settings. Settings lookup failures fail closed (tools omitted).
 */
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  MTCODE_DESKTOP_ENV_PREFIX,
  mtcodeDesktopProfileEnv,
} from "@t3tools/shared/munimComputerUse";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import { resolveDesktopMcpPath } from "./desktopMcpBinary.ts";

export type DesktopMcpLaunch = {
  readonly path: string;
  readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
};

type DesktopControlFlags = {
  readonly enabled: boolean;
  readonly agentCursorEnabled: boolean;
  readonly browserControlEnabled: boolean;
};

const disabledDesktopControl = {
  enabled: false,
  agentCursorEnabled: false,
  browserControlEnabled: false,
} as const satisfies DesktopControlFlags;

/**
 * Always acquire `ServerSettings.ServerSettingsService` from the Effect
 * environment. Callers that need R=never session methods should use
 * `makeResolveEnabledDesktopMcp` instead of yielding this effect directly.
 */
const readDesktopControlFlags = Effect.fn("desktopControl.readDesktopControlFlags")(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  return yield* settings.getSettings.pipe(
    Effect.map((snapshot): DesktopControlFlags => snapshot.desktopControl),
    // Fail closed: never inject desktop MCP when we cannot confirm enablement.
    Effect.orElseSucceed((): DesktopControlFlags => disabledDesktopControl),
  );
});

export const resolveEnabledDesktopMcp = Effect.fn("desktopControl.resolveEnabledDesktopMcp")(
  function* () {
    const path = yield* resolveDesktopMcpPath();
    if (path === undefined) {
      return undefined;
    }

    const desktopControl = yield* readDesktopControlFlags();
    if (!desktopControl.enabled) {
      return undefined;
    }

    // Run munim-computer-use under MT Code's identity: its own bridge socket,
    // agent-cursor app and Chrome native host, and MT-prefixed tunables.
    const env: Array<{ name: string; value: string }> = Object.entries(
      mtcodeDesktopProfileEnv(),
    ).map(([name, value]) => ({ name, value }));
    if (!desktopControl.agentCursorEnabled) {
      env.push({ name: `${MTCODE_DESKTOP_ENV_PREFIX}AGENT_CURSOR`, value: "0" });
    }
    if (!desktopControl.browserControlEnabled) {
      env.push({ name: `${MTCODE_DESKTOP_ENV_PREFIX}BROWSER`, value: "0" });
    }

    return { path, env } satisfies DesktopMcpLaunch;
  },
);

/**
 * Capture desktop-MCP resolution dependencies once at adapter construction so
 * each session can re-read settings without widening `startSession`'s Effect
 * context (adapters require `R = never` on session methods).
 */
export const makeResolveEnabledDesktopMcp = Effect.fn(
  "desktopControl.makeResolveEnabledDesktopMcp",
)(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;

  return () =>
    resolveEnabledDesktopMcp().pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, settings),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcessPlatform, platform),
      Effect.provideService(HostProcessEnvironment, environment),
    );
});
