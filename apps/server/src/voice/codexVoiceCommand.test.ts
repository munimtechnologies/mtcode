import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveCodexVoiceCommand } from "./codexVoiceCommand.ts";

const decodeSettings = Schema.decodeSync(ServerSettings);

it.layer(NodeServices.layer)("resolveCodexVoiceCommand", (it) => {
  it.effect("starts the configured Codex install as an app-server", () =>
    Effect.gen(function* () {
      const settings = decodeSettings({
        providers: {
          codex: {
            binaryPath: "/opt/codex/bin/codex",
            homePath: "/tmp/codex-home",
            launchArgs: "--enable voice_preview",
          },
        },
      });
      const command = yield* resolveCodexVoiceCommand(settings, {});
      expect(Option.isSome(command)).toBe(true);
      const value = Option.getOrThrow(command);
      expect(value.command).toBe("/opt/codex/bin/codex");
      expect(value.args).toEqual(["app-server", "--enable", "voice_preview"]);
      expect(value.env.CODEX_HOME).toBe("/tmp/codex-home");
    }),
  );

  it.effect("prefers the default instance over other enabled Codex instances", () =>
    Effect.gen(function* () {
      const settings = decodeSettings({
        providers: { codex: { binaryPath: "default-codex" } },
        providerInstances: {
          [ProviderInstanceId.make("codex-work")]: {
            driver: "codex",
            config: { binaryPath: "work-codex" },
          },
        },
      });
      const value = Option.getOrThrow(yield* resolveCodexVoiceCommand(settings, {}));
      expect(value.command).toBe("default-codex");
    }),
  );

  it.effect("reports no command when every Codex instance is disabled", () =>
    Effect.gen(function* () {
      const settings = decodeSettings({
        providerInstances: {
          [ProviderInstanceId.make("codex")]: {
            driver: "codex",
            enabled: false,
            config: { binaryPath: "codex" },
          },
        },
      });
      expect(Option.isNone(yield* resolveCodexVoiceCommand(settings, {}))).toBe(true);
    }),
  );

  it.effect("falls back to a PATH lookup when no binary path is configured", () =>
    Effect.gen(function* () {
      const value = Option.getOrThrow(yield* resolveCodexVoiceCommand(DEFAULT_SERVER_SETTINGS, {}));
      expect(value.command).toBe("codex");
      expect(value.args).toEqual(["app-server"]);
    }),
  );
});
