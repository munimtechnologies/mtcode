// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - Hosted handoff test uses a real localhost listener without an OpenAI account.
import * as NodeHttp from "node:http";
import * as NodePath from "@effect/platform-node/NodePath";
import { codexAuthHandoffUrl, readCodexAuthDelivery } from "@t3tools/shared/codexAuthHandoff";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const { createClerkBridgeMock, storageAdapter, storageMock } = vi.hoisted(() => ({
  createClerkBridgeMock: vi.fn(),
  storageAdapter: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  storageMock: vi.fn(),
}));

vi.mock("@clerk/electron", () => ({
  createClerkBridge: createClerkBridgeMock,
}));

vi.mock("@clerk/electron/storage", () => ({
  storage: storageMock,
}));

import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopClerk from "./DesktopClerk.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import {
  applyPendingDesktopProtocolUrl,
  takePendingDesktopProtocolUrl,
} from "./desktopProtocolUrl.ts";
import * as DesktopPreReadyFileSystem from "./DesktopPreReadyFileSystem.ts";

/** Clerk forwards web links; tests that are not about links ignore them. */
const ignoreWebLinks = DesktopWebLinks.DesktopWebLinks.of({
  receive: () => Effect.void,
  setRendererReady: () => Effect.void,
});

const layerDesktopClerk = (
  isDevelopment = true,
  events: string[] = [],
  platform: NodeJS.Platform = "linux",
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = FileSystem.layerNoop({
    exists: () => Effect.succeed(false),
  }),
  shell: ElectronShell.ElectronShell["Service"] = {
    openExternal: () => Effect.succeed(true),
    openSystemSettings: () => Effect.succeed(false),
    copyText: () => Effect.void,
  },
) => {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    stateDir: "/tmp/t3-state",
    isDevelopment,
    appDataDirectory: "/tmp/app-data",
    platform,
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

  const electronApp = {
    setPath: (name: string, value: string) =>
      Effect.sync(() => {
        events.push(`setPath:${name}:${value}`);
      }),
  } as unknown as ElectronApp.ElectronApp["Service"];

  return DesktopClerk.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodePath.layerPosix,
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
        Layer.succeed(ElectronApp.ElectronApp, electronApp),
        Layer.succeed(ElectronShell.ElectronShell, shell),
        fileSystemLayer,
      ),
    ),
  );
};

const unusedDesktopWindow = {
  createMainIfBackendReady: Effect.void,
} as unknown as DesktopWindow.DesktopWindow["Service"];

describe("DesktopClerk", () => {
  beforeEach(() => {
    createClerkBridgeMock.mockReset();
    storageMock.mockReset();
    takePendingDesktopProtocolUrl();
  });

  it.effect("acquires and releases the SDK bridge with the layer", () => {
    const cleanup = vi.fn();
    const events: string[] = [];
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockImplementation(() => {
      events.push("createClerkBridge");
      return { cleanup, isPrimaryInstance: true };
    });

    return Effect.gen(function* () {
      yield* Effect.scoped(Layer.build(layerDesktopClerk(true, events)));

      assert.deepEqual(createClerkBridgeMock.mock.calls, [
        [
          {
            storage: storageAdapter,
            passkeys: true,
            renderer: { scheme: "t3code-dev", host: "app" },
          },
        ],
      ]);
      assert.equal(cleanup.mock.calls.length, 1);
      // The bridge acquires Electron's single-instance lock at creation, and
      // the lock both lives in and creates the userData directory — so the
      // real path must be set before the bridge exists.
      assert.deepEqual(events, ["setPath:userData:/tmp/app-data/t3code-dev", "createClerkBridge"]);
      storageMock.mockClear();
      createClerkBridgeMock.mockClear();
    });
  });

  it.each([
    {
      name: "packaged Windows",
      isDevelopment: false,
      platform: "win32" as const,
      userData: "/tmp/app-data/t3code-v2",
    },
    {
      name: "development",
      isDevelopment: true,
      platform: "win32" as const,
      userData: "/tmp/app-data/t3code-dev",
    },
  ])(
    "creates the bridge before startup can yield to the event loop ($name)",
    ({ isDevelopment, platform, userData }) => {
      const events: string[] = [];
      storageMock.mockReturnValue(storageAdapter);
      createClerkBridgeMock.mockImplementation(() => {
        events.push("createClerkBridge");
        return { cleanup: vi.fn(), isPrimaryInstance: true };
      });
      // runSync throws if the layer ever suspends, which would let Electron emit
      // ready before the bridge exists. main.ts provides the same FileSystem.
      // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- The assertion IS that the layer builds synchronously; it.effect would mask a regression to async.
      Effect.runSync(
        Effect.scoped(
          Layer.build(
            layerDesktopClerk(isDevelopment, events, platform, DesktopPreReadyFileSystem.layer),
          ),
        ),
      );

      assert.deepEqual(events, [`setPath:userData:${userData}`, "createClerkBridge"]);
    },
  );

  it.effect("preserves bridge initialization failures", () => {
    const cause = new Error("bridge initialization failed");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockImplementationOnce(() => {
      throw cause;
    });

    return Effect.gen(function* () {
      const error = yield* Effect.scoped(Layer.build(layerDesktopClerk())).pipe(Effect.flip);

      assert.instanceOf(error, DesktopClerk.DesktopClerkBridgeInitializationError);
      assert.equal(error.stateDir, "/tmp/t3-state");
      assert.equal(error.isDevelopment, true);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        'Failed to initialize the desktop Clerk bridge for state directory "/tmp/t3-state" (development: true).',
      );
    });
  });

  it.effect("preserves bridge cleanup failures", () => {
    const cause = new Error("bridge cleanup failed");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({
      cleanup: () => {
        throw cause;
      },
    });

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(layerDesktopClerk(false))));

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, DesktopClerk.DesktopClerkBridgeCleanupError);
        assert.equal(error.stateDir, "/tmp/t3-state");
        assert.equal(error.isDevelopment, false);
        assert.strictEqual(error.cause, cause);
        assert.equal(
          error.message,
          'Failed to clean up the desktop Clerk bridge for state directory "/tmp/t3-state" (development: false).',
        );
      }
    });
  });

  it.effect("registers the second-instance handler in the primary instance", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const quit = vi.fn();
    const registeredEvents: string[] = [];
    const electronApp = {
      quit: Effect.sync(quit),
      on: (eventName: string) =>
        Effect.sync(() => {
          registeredEvents.push(eventName);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {} as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const clerk = yield* DesktopClerk.DesktopClerk;
      const exit = yield* Effect.exit(Effect.scoped(clerk.configure));

      assert.isTrue(Exit.isSuccess(exit));
      assert.equal(quit.mock.calls.length, 0);
      assert.deepEqual(registeredEvents, ["open-url", "open-file", "second-instance"]);
    }).pipe(
      Effect.provide(layerDesktopClerk()),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
    );
  });

  it.effect("loads a second-instance protocol URL on the existing window", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const loadURL = vi.fn(() => Promise.resolve());
    const mainWindow = { loadURL };
    const revealed: unknown[] = [];
    const electronApp = {
      quit: Effect.void,
      on: (eventName: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(eventName, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {
      main: Effect.succeed(Option.some(mainWindow)),
      currentMainOrFirst: Effect.succeed(Option.some(mainWindow)),
      reveal: (window: unknown) =>
        Effect.sync(() => {
          revealed.push(window);
        }),
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.scoped(
      Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;

        const url = "t3code-dev://app/CLERK-ROUTER/VIRTUAL/sign-in?__clerk_status=complete";
        listeners.get("second-instance")?.({}, ["electron", "--hidden", url], process.cwd());
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.deepEqual(revealed, [mainWindow]);
            assert.deepEqual(loadURL.mock.calls, [[url]]);
          }),
        );

        // The SDK owns modern OAuth callbacks. Keep its renderer alive long
        // enough to exchange the nonce and activate the authenticated session.
        listeners.get("second-instance")?.({}, [
          "electron",
          "t3code-dev://app/?__clerk_status=verified&rotating_token_nonce=test-nonce",
        ]);
        yield* Effect.promise(() =>
          vi.waitFor(() => assert.deepEqual(revealed, [mainWindow, mainWindow])),
        );
        assert.deepEqual(loadURL.mock.calls, [[url]]);
        assert.equal(takePendingDesktopProtocolUrl(), null);
      }),
    ).pipe(
      Effect.provide(layerDesktopClerk()),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
    );
  });

  it.effect("reveals the window when second-instance argv has no protocol URL", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const loadURL = vi.fn(() => Promise.resolve());
    const mainWindow = { loadURL };
    const revealed: unknown[] = [];
    const electronApp = {
      quit: Effect.void,
      on: (eventName: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(eventName, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {
      main: Effect.succeed(Option.some(mainWindow)),
      currentMainOrFirst: Effect.succeed(Option.some(mainWindow)),
      reveal: (window: unknown) =>
        Effect.sync(() => {
          revealed.push(window);
        }),
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.scoped(
      Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;

        listeners.get("second-instance")?.({}, ["electron", "--hidden"], process.cwd());
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.deepEqual(revealed, [mainWindow]);
          }),
        );
        assert.deepEqual(loadURL.mock.calls, []);
      }),
    ).pipe(
      Effect.provide(layerDesktopClerk()),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
    );
  });

  it.effect("loads macOS open-url deep links on the existing window", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const loadURL = vi.fn(() => Promise.resolve());
    const mainWindow = { loadURL };
    const revealed: unknown[] = [];
    const electronApp = {
      quit: Effect.void,
      on: (eventName: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(eventName, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {
      main: Effect.succeed(Option.some(mainWindow)),
      currentMainOrFirst: Effect.succeed(Option.some(mainWindow)),
      reveal: (window: unknown) =>
        Effect.sync(() => {
          revealed.push(window);
        }),
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.scoped(
      Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;

        assert.deepEqual([...listeners.keys()], ["open-url", "open-file", "second-instance"]);

        const url = "t3code-dev://app/sso-callback";
        const preventDefault = vi.fn();
        listeners.get("open-url")?.({ preventDefault }, url);
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.equal(preventDefault.mock.calls.length, 1);
            assert.deepEqual(revealed, [mainWindow]);
            assert.deepEqual(loadURL.mock.calls, [[url]]);
          }),
        );
      }),
    ).pipe(
      Effect.provide(layerDesktopClerk(true, [], "darwin")),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
    );
  });

  it.effect("queues macOS open-url when no window exists and later dispatches", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const loadURL = vi.fn(() => Promise.resolve());
    const mainWindow = { loadURL };
    const createMainAttempts: string[] = [];
    const electronApp = {
      quit: Effect.void,
      on: (eventName: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(eventName, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {
      main: Effect.succeed(Option.none()),
      currentMainOrFirst: Effect.succeed(Option.none()),
      reveal: () => Effect.die("unexpected reveal before main exists"),
    } as unknown as ElectronWindow.ElectronWindow["Service"];
    const desktopWindow = {
      createMainIfBackendReady: Effect.sync(() => {
        createMainAttempts.push("createMainIfBackendReady");
      }),
    } as unknown as DesktopWindow.DesktopWindow["Service"];

    return Effect.scoped(
      Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;

        const url = "t3code-dev://app/sso-callback";
        const preventDefault = vi.fn();
        listeners.get("open-url")?.({ preventDefault }, url);
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.equal(preventDefault.mock.calls.length, 1);
            assert.deepEqual(createMainAttempts, ["createMainIfBackendReady"]);
            assert.deepEqual(loadURL.mock.calls, []);
          }),
        );

        // Same seam DesktopWindow.createMain uses after setMain.
        assert.equal(applyPendingDesktopProtocolUrl(mainWindow), true);
        assert.deepEqual(loadURL.mock.calls, [[url]]);
      }),
    ).pipe(
      Effect.provide(layerDesktopClerk(true, [], "darwin")),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, desktopWindow),
    );
  });

  it.effect("does not apply a stale deep link after a newer one is queued", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const loadURL = vi.fn(() => Promise.resolve());
    const mainWindow = { loadURL };
    let currentMain = Option.none<typeof mainWindow>();
    const electronApp = {
      quit: Effect.void,
      on: (eventName: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(eventName, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {
      main: Effect.sync(() => currentMain),
      currentMainOrFirst: Effect.sync(() => currentMain),
      reveal: () => Effect.void,
    } as unknown as ElectronWindow.ElectronWindow["Service"];

    return Effect.scoped(
      Effect.gen(function* () {
        const enteredCreate = yield* Deferred.make<void>();
        const releaseCreate = yield* Deferred.make<void>();
        const desktopWindow = {
          createMainIfBackendReady: Effect.gen(function* () {
            yield* Deferred.succeed(enteredCreate, undefined);
            yield* Deferred.await(releaseCreate);
            applyPendingDesktopProtocolUrl(mainWindow);
            currentMain = Option.some(mainWindow);
          }),
        } as unknown as DesktopWindow.DesktopWindow["Service"];

        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure.pipe(
          Effect.provideService(DesktopWindow.DesktopWindow, desktopWindow),
        );

        const older = "t3code-dev://app/sso-callback?state=old";
        const newer = "t3code-dev://app/sso-callback?state=new";
        listeners.get("open-url")?.({ preventDefault: vi.fn() }, older);
        yield* Deferred.await(enteredCreate);
        listeners.get("open-url")?.({ preventDefault: vi.fn() }, newer);
        yield* Deferred.succeed(releaseCreate, undefined);
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.deepEqual(loadURL.mock.calls, [[newer]]);
          }),
        );
        assert.equal(takePendingDesktopProtocolUrl(), null);
      }),
    ).pipe(
      Effect.provide(layerDesktopClerk(true, [], "darwin")),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  });

  it.effect("does not load a protocol URL on the WSL connecting splash", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const splashLoadURL = vi.fn(() => Promise.resolve());
    const mainLoadURL = vi.fn(() => Promise.resolve());
    const splashWindow = { loadURL: splashLoadURL };
    const mainWindow = { loadURL: mainLoadURL };
    const revealed: unknown[] = [];
    const electronApp = {
      quit: Effect.void,
      on: (eventName: string, listener: (...args: readonly unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(eventName, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const createMainAttempts: string[] = [];
    const electronWindow = {
      main: Effect.succeed(Option.none()),
      currentMainOrFirst: Effect.succeed(Option.some(splashWindow)),
      reveal: (window: unknown) =>
        Effect.sync(() => {
          revealed.push(window);
        }),
    } as unknown as ElectronWindow.ElectronWindow["Service"];
    const desktopWindow = {
      createMainIfBackendReady: Effect.sync(() => {
        createMainAttempts.push("createMainIfBackendReady");
      }),
    } as unknown as DesktopWindow.DesktopWindow["Service"];

    return Effect.scoped(
      Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;

        const url = "t3code-dev://app/sso-callback";
        listeners.get("second-instance")?.({}, ["electron", url], process.cwd());
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.deepEqual(createMainAttempts, ["createMainIfBackendReady"]);
            assert.deepEqual(splashLoadURL.mock.calls, []);
          }),
        );
        assert.deepEqual(revealed, []);
        assert.deepEqual(mainLoadURL.mock.calls, []);

        assert.equal(applyPendingDesktopProtocolUrl(mainWindow), true);
        assert.deepEqual(splashLoadURL.mock.calls, []);
        assert.deepEqual(mainLoadURL.mock.calls, [[url]]);
      }),
    ).pipe(
      Effect.provide(layerDesktopClerk()),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, desktopWindow),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
    );
  });

  it.effect("quits and interrupts startup in a secondary instance", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: false });
    const quit = vi.fn();
    const registeredEvents: string[] = [];
    const electronApp = {
      quit: Effect.sync(quit),
      on: (eventName: string) =>
        Effect.sync(() => {
          registeredEvents.push(eventName);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {} as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const clerk = yield* DesktopClerk.DesktopClerk;
      const exit = yield* Effect.exit(Effect.scoped(clerk.configure));

      assert.isTrue(Exit.hasInterrupts(exit));
      assert.equal(quit.mock.calls.length, 1);
      assert.deepEqual(registeredEvents, []);
    }).pipe(
      Effect.provide(layerDesktopClerk()),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      // A secondary instance quits before it ever reaches the window, so an
      // empty stand-in is enough to satisfy the layer's requirement.
      Effect.provideService(
        DesktopWindow.DesktopWindow,
        {} as DesktopWindow.DesktopWindow["Service"],
      ),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
    );
  });
});

it.effect(
  "provider auth deep links navigate and reveal the running desktop without handling Clerk URLs",
  () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const revealed = Promise.withResolvers<void>();
    const loadURL = vi.fn(async (_url: string) => undefined);
    const window = { loadURL };
    const electronApp = {
      on: (name: string, listener: (...args: unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(name, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const electronWindow = {
      currentMainOrFirst: Effect.succeed(Option.some(window)),
      reveal: () => Effect.sync(() => revealed.resolve()),
    } as unknown as ElectronWindow.ElectronWindow["Service"];
    return Effect.gen(function* () {
      const clerk = yield* DesktopClerk.DesktopClerk;
      yield* clerk.configure;
      const event = { preventDefault: vi.fn() };
      listeners.get("open-url")!(event, "t3code-dev://app/auth/callback?code=clerk-code");
      listeners.get("open-url")!(event, "t3code://app/welcome");
      assert.equal(loadURL.mock.calls.length, 0);
      assert.equal(event.preventDefault.mock.calls.length, 0);
      listeners.get("second-instance")!({}, [
        "t3",
        "t3code-dev://app/settings/providers?instanceId=work&code=never-forward",
      ]);
      yield* Effect.promise(() => revealed.promise);
      assert.deepEqual(loadURL.mock.calls, [
        ["t3code-dev://app/settings/providers?instanceId=work"],
      ]);
      listeners.get("open-url")!(event, "t3code-dev://app/welcome#agents:machine-id");
      assert.equal(event.preventDefault.mock.calls.length, 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(layerDesktopClerk()),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
      Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
      Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
    );
  },
);

it.effect.each(["startup", "open-url"] as const)(
  "receives hosted web sign-in through the desktop %s handler",
  (entry) =>
    Effect.gen(function* () {
      storageMock.mockReturnValue(storageAdapter);
      createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
      const port = yield* Effect.promise(async () => {
        const server = NodeHttp.createServer();
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("address");
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return address.port;
      });
      const authorize = new URL("https://auth.openai.com/api/accounts/authorize");
      authorize.search = new URLSearchParams({
        client_id: "dynamic_agent_client",
        response_type: "code",
        redirect_uri: `http://127.0.0.1:${port}/auth/callback`,
        state: "a".repeat(43),
        code_challenge_method: "S256",
        code_challenge: "b".repeat(43),
      }).toString();
      const request = {
        authorizationUrl: authorize.toString(),
        returnUrl: "https://app.t3.codes/welcome#agents:remote-one",
        environmentId: EnvironmentId.make("remote-one"),
        instanceId: ProviderInstanceId.make("work"),
        flowId: "flow-one",
      };
      const link = codexAuthHandoffUrl(request, true);
      const delivered = Promise.withResolvers<string>();
      const shell = ElectronShell.ElectronShell.of({
        openExternal: (value) =>
          Effect.promise(async () => {
            const url = new URL(String(value));
            const callback = new URL(url.searchParams.get("redirect_uri")!);
            callback.search = new URLSearchParams({
              state: url.searchParams.get("state")!,
              code: "test-code",
              client_id: "oaiapp_test",
            }).toString();
            const response = await fetch(callback, { redirect: "manual" });
            delivered.resolve(response.headers.get("location")!);
            return true;
          }),
        openSystemSettings: () => Effect.succeed(false),
        copyText: () => Effect.void,
      });
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const electronApp = {
        whenReady: Effect.void,
        on: (name: string, listener: (...args: unknown[]) => void) =>
          Effect.sync(() => {
            listeners.set(name, listener);
          }),
      } as unknown as ElectronApp.ElectronApp["Service"];
      yield* Effect.gen(function* () {
        const clerk = yield* DesktopClerk.DesktopClerk;
        yield* clerk.configure;
        if (entry === "open-url") {
          const event = { preventDefault: vi.fn() };
          listeners.get("open-url")!(event, link);
          assert.strictEqual(event.preventDefault.mock.calls.length, 1);
        }
        const delivery = readCodexAuthDelivery(yield* Effect.promise(() => delivered.promise));
        assert.strictEqual(delivery?.environmentId, request.environmentId);
        assert.strictEqual(delivery?.instanceId, request.instanceId);
        assert.strictEqual(delivery?.flowId, request.flowId);
        assert.strictEqual(delivery?.returnUrl, request.returnUrl);
      }).pipe(
        Effect.provide(layerDesktopClerk(true, [], "linux", undefined, shell)),
        Effect.provideService(HostProcess.Arguments, entry === "startup" ? ["t3", link] : ["t3"]),
        Effect.provideService(ElectronApp.ElectronApp, electronApp),
        Effect.provideService(
          ElectronWindow.ElectronWindow,
          {} as ElectronWindow.ElectronWindow["Service"],
        ),
        Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
        Effect.provideService(DesktopWebLinks.DesktopWebLinks, ignoreWebLinks),
      );
    }).pipe(Effect.scoped),
);

it.effect("hands a web link to the renderer and leaves other links alone", () =>
  Effect.gen(function* () {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: true });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const electronApp = {
      whenReady: Effect.void,
      on: (name: string, listener: (...args: unknown[]) => void) =>
        Effect.sync(() => {
          listeners.set(name, listener);
        }),
    } as unknown as ElectronApp.ElectronApp["Service"];
    const received: Array<string> = [];
    yield* Effect.gen(function* () {
      const clerk = yield* DesktopClerk.DesktopClerk;
      yield* clerk.configure;
      const open = (url: string) => {
        const event = { preventDefault: vi.fn() };
        listeners.get("open-url")!(event, url);
        return event.preventDefault.mock.calls.length;
      };
      // macOS hands the default browser every web link.
      assert.strictEqual(open("https://example.com/page"), 1);
      assert.strictEqual(open("http://localhost:3000/"), 1);
      // Anything else is not a web page; Electron keeps its own handling.
      assert.strictEqual(open("mailto:hello@example.com"), 0);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(received, ["https://example.com/page", "http://localhost:3000/"]);
    }).pipe(
      Effect.provide(layerDesktopClerk(true, [], "darwin")),
      Effect.provideService(HostProcess.Arguments, ["t3"]),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(
        ElectronWindow.ElectronWindow,
        {} as ElectronWindow.ElectronWindow["Service"],
      ),
      Effect.provideService(DesktopWindow.DesktopWindow, unusedDesktopWindow),
      Effect.provideService(
        DesktopWebLinks.DesktopWebLinks,
        DesktopWebLinks.DesktopWebLinks.of({
          receive: (url) => Effect.sync(() => void received.push(url)),
          setRendererReady: () => Effect.void,
        }),
      ),
    );
  }).pipe(Effect.scoped),
);
