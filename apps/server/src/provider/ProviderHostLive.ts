/**
 * The server's implementation of `ProviderHost`, the only server surface
 * provider drivers and adapters may use.
 *
 * @module provider/ProviderHostLive
 */
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import { ProviderCredentialError } from "@t3tools/provider-core/server/errors";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import { makeOptionalResolveEnabledDesktopMcp } from "../desktopControl/desktopMcpLaunch.ts";
import {
  cursorUserDefinesDesktopMcp,
  grokUserDefinesDesktopMcp,
} from "../desktopControl/desktopMcpUserConfig.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderCredentialStore from "./ProviderCredentialStore.ts";

export const layer = Layer.effect(
  ProviderHost,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const crypto = yield* Crypto.Crypto;
    // MT Code: Computer Use for provider packages; hosts without the platform
    // services (narrow test layers) run sessions without it.
    const resolveDesktopMcp = yield* makeOptionalResolveEnabledDesktopMcp();
    const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
    const path = yield* Effect.serviceOption(Path.Path);
    const desktopMcp =
      resolveDesktopMcp === undefined || Option.isNone(fileSystem) || Option.isNone(path)
        ? undefined
        : {
            resolve: resolveDesktopMcp,
            userDefines: (
              agent: "cursor" | "grok",
              input: { readonly cwd?: string; readonly environment: NodeJS.ProcessEnv },
            ) =>
              (agent === "cursor"
                ? cursorUserDefinesDesktopMcp(input)
                : grokUserDefinesDesktopMcp(input)
              ).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem.value),
                Effect.provideService(Path.Path, path.value),
              ),
          };
    return ProviderHost.of({
      ...(desktopMcp === undefined ? {} : { desktopMcp }),
      paths: {
        cwd: config.cwd,
        baseDir: config.baseDir,
        stateDir: config.stateDir,
        providerStatusCacheDir: config.providerStatusCacheDir,
        attachmentsDir: config.attachmentsDir,
      },
      settings: {
        get: serverSettings.getSettings,
        withSnapshot: serverSettings.withSettingsSnapshot,
        changes: serverSettings.streamChanges,
        subscribe: serverSettings.subscribeChanges,
      },
      shouldRunBackgroundWork: backgroundPolicy.shouldRunScopeWork,
      resolveAttachmentPath: (attachment) =>
        resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment }),
      credentials: (namespace, bindingId) =>
        ProviderCredentialStore.make(namespace, bindingId).pipe(
          Effect.map((store) => ({
            binding: store.binding,
            get: store.get.pipe(
              Effect.mapError((cause) => new ProviderCredentialError({ operation: "get", cause })),
            ),
            set: (credentials: Uint8Array) =>
              store
                .set(credentials)
                .pipe(
                  Effect.mapError(
                    (cause) => new ProviderCredentialError({ operation: "set", cause }),
                  ),
                ),
            remove: store.remove.pipe(
              Effect.mapError(
                (cause) => new ProviderCredentialError({ operation: "remove", cause }),
              ),
            ),
          })),
          Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
          Effect.provideService(Crypto.Crypto, crypto),
        ),
    });
  }),
);
