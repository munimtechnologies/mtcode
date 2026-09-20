import {
  CodexSettings,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { codexAppServerArgs, resolveCodexLaunchArgs } from "../provider/Layers/codexLaunchArgs.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";

const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const CODEX_DRIVER = ProviderDriverKind.make("codex");

export interface CodexVoiceCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Account voice runs inside the user's own Codex install, so it has to start the
 * same binary, launch args and `CODEX_HOME` the Codex provider itself would use.
 * The default instance wins when several are enabled: it is the one whose
 * ChatGPT login Settings → Providers manages.
 */
export const resolveCodexVoiceCommand = Effect.fn("voice.resolveCodexVoiceCommand")(function* (
  settings: ServerSettings,
  hostEnvironment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<Option.Option<CodexVoiceCommand>, never, Path.Path> {
  const instances = deriveProviderInstanceConfigMap(settings);
  const defaultId = defaultInstanceIdForDriver(CODEX_DRIVER);
  const enabled = Object.entries(instances).filter(
    ([, instance]) => instance.enabled !== false && instance.driver === CODEX_DRIVER,
  );
  const selected = enabled.find(([id]) => id === defaultId) ?? enabled[0];
  if (!selected) return Option.none();
  const [, instance] = selected;
  const config = decodeCodexSettings(instance.config ?? {});
  if (Option.isNone(config)) return Option.none();
  const environment = mergeProviderInstanceEnvironment(instance.environment ?? [], hostEnvironment);
  const layout = yield* resolveCodexHomeLayout(config.value);
  const launchArgs = resolveCodexLaunchArgs(config.value.launchArgs, environment);
  return Option.some({
    command: config.value.binaryPath.trim() || "codex",
    args: codexAppServerArgs(launchArgs),
    env: {
      ...environment,
      ...(layout.effectiveHomePath ? { CODEX_HOME: layout.effectiveHomePath } : {}),
    },
  });
});
