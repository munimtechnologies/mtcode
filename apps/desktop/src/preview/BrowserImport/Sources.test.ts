// @effect-diagnostics nodeBuiltinImport:off - Builds a Chromium-shaped cookie
// table with the same native bindings the source reads.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as NodeSqlite from "node:sqlite";

import type { BrowserImportPathContext } from "./Sources.ts";
import {
  BROWSER_IMPORT_SOURCES,
  cookieDatabaseCandidatePaths,
  isSourceInstalled,
  isSourceRunning,
  listSourceProfiles,
  sourcePathContext,
} from "./Sources.ts";

const helium = BROWSER_IMPORT_SOURCES.find((source) => source.id === "helium")!;

/** A scratch home with the source's user-data directory already created. */
const withSourceHome = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-sources-" });
  const context = yield* sourcePathContext.pipe(
    Effect.provideService(HostProcessEnvironment, { HOME: home }),
    Effect.provideService(HostProcessPlatform, "darwin"),
  );
  yield* fileSystem.makeDirectory(userDataDirectory(context), { recursive: true });
  return context;
});

/** Every case here runs on darwin, where Helium always resolves a directory. */
const userDataDirectory = (context: BrowserImportPathContext) => {
  const root = helium.userDataDirectory(context);
  if (root === undefined) throw new Error("Helium has no macOS user-data directory");
  return root;
};

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  effect.pipe(Effect.provide(NodeServices.layer), Effect.scoped);

/** Writes a Chromium-shaped cookie table with `count` rows. */
const writeCookieDatabase = (file: string, count: number) =>
  Effect.sync(() => {
    const database = new NodeSqlite.DatabaseSync(file);
    database.exec("create table cookies (host_key text, name text)");
    const insert = database.prepare("insert into cookies (host_key, name) values (?, ?)");
    for (let index = 0; index < count; index += 1) insert.run("example.test", `c${index}`);
    database.close();
  });

describe("isSourceRunning", () => {
  it.effect("reads Chromium's dangling SingletonLock symlink as a running browser", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        assert.isFalse(yield* isSourceRunning(helium, context));

        // Chromium points the lock at `<host>-<pid>`, a target that never
        // exists on disk. A check that follows the link reports a running
        // browser as closed, letting an import read a live, mid-write database.
        yield* fileSystem.symlink(
          "host-that-does-not-exist-1234",
          `${userDataDirectory(context)}/SingletonLock`,
        );

        assert.isTrue(yield* isSourceRunning(helium, context));
      }),
    ),
  );
});

describe("isSourceInstalled", () => {
  it.effect("ignores a user-data directory that holds no cookie database", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = userDataDirectory(context);

        // Installers for native messaging hosts create an empty user-data
        // directory for every Chromium fork they know about, so treating the
        // directory as evidence lists browsers the user does not have.
        yield* fileSystem.makeDirectory(`${root}/NativeMessagingHosts`, { recursive: true });
        assert.isFalse(yield* isSourceInstalled(helium, context));

        yield* fileSystem.makeDirectory(`${root}/Default`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Default/Cookies`, "db");
        assert.isTrue(yield* isSourceInstalled(helium, context));

        // A real install whose cookies live outside `Default` still counts:
        // reporting it as absent hides the source from the menu entirely.
        yield* fileSystem.remove(`${root}/Default`, { recursive: true });
        yield* fileSystem.makeDirectory(`${root}/Profile 1`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Profile 1/Cookies`, "db");
        assert.isTrue(yield* isSourceInstalled(helium, context));

        yield* fileSystem.remove(root, { recursive: true });
        assert.isFalse(yield* isSourceInstalled(helium, context));
      }),
    ),
  );

  it.effect("detects a Chromium 127+ install with cookies under Network/", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = userDataDirectory(context);

        yield* fileSystem.makeDirectory(`${root}/Default/Network`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Default/Network/Cookies`, "db");
        assert.isTrue(yield* isSourceInstalled(helium, context));
      }),
    ),
  );
});

describe("listSourceProfiles", () => {
  it.effect("discovers profiles by their cookie database when Local State is absent", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = userDataDirectory(context);
        // Assuming `Default` would report a browser whose cookies live in
        // `Profile 1` as having nothing to import, and it is then hidden.
        yield* fileSystem.makeDirectory(`${root}/Profile 1`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Profile 1/Cookies`, "db");
        yield* fileSystem.makeDirectory(`${root}/NativeMessagingHosts`, { recursive: true });

        assert.deepEqual(yield* listSourceProfiles(helium, context), [
          { directory: "Profile 1", name: "Profile 1" },
        ]);
      }),
    ),
  );

  it.effect("reads the profile names the browser shows", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        yield* fileSystem.writeFileString(
          `${userDataDirectory(context)}/Local State`,
          `{"profile":{"info_cache":{"Default":{"name":"You"},"Profile 2":{"name":"  "}}}}`,
        );

        assert.deepEqual(yield* listSourceProfiles(helium, context), [
          { directory: "Default", name: "You" },
          // Blank display name falls back to the directory rather than
          // rendering an empty row.
          { directory: "Profile 2", name: "Profile 2" },
        ]);
      }),
    ),
  );

  it.effect("scans for profiles when Local State is malformed", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = userDataDirectory(context);
        yield* fileSystem.writeFileString(`${root}/Local State`, "{not-json");
        yield* fileSystem.makeDirectory(`${root}/Default`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Default/Cookies`, "db");

        assert.deepEqual(yield* listSourceProfiles(helium, context), [
          { directory: "Default", name: "Default" },
        ]);
      }),
    ),
  );

  it.effect("reports nothing when no directory holds a cookie database", () =>
    run(
      Effect.gen(function* () {
        const context = yield* withSourceHome();
        assert.deepEqual(yield* listSourceProfiles(helium, context), []);
      }),
    ),
  );

  it.effect("drops Firefox profiles that hold no cookie database", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = firefox.userDataDirectory(context)!;
        yield* fileSystem.makeDirectory(root, { recursive: true });
        yield* fileSystem.writeFileString(
          `${root}/profiles.ini`,
          `[Profile0]
Name=original
IsRelative=1
Path=Profiles/abcd.default-release
Default=1

[Profile1]
Name=empty
IsRelative=1
Path=Profiles/wxyz.empty
`,
        );
        yield* fileSystem.makeDirectory(`${root}/Profiles/abcd.default-release`, {
          recursive: true,
        });
        yield* fileSystem.writeFileString(
          `${root}/Profiles/abcd.default-release/cookies.sqlite`,
          "db",
        );
        yield* fileSystem.makeDirectory(`${root}/Profiles/wxyz.empty`, { recursive: true });

        assert.deepEqual(yield* listSourceProfiles(firefox, context), [
          { directory: "Profiles/abcd.default-release", name: "original" },
        ]);
      }),
    ),
  );

  it.effect("drops empty profiles when falling back to the Profiles/ scan", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = firefox.userDataDirectory(context)!;
        yield* fileSystem.makeDirectory(`${root}/Profiles/filled.default`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Profiles/filled.default/cookies.sqlite`, "db");
        yield* fileSystem.makeDirectory(`${root}/Profiles/empty.default`, { recursive: true });

        assert.deepEqual(yield* listSourceProfiles(firefox, context), [
          {
            directory: context.path.join("Profiles", "filled.default"),
            name: "filled.default",
          },
        ]);
      }),
    ),
  );

  it.effect("discovers profiles with cookies under Network/ (Chromium 127+)", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        const root = userDataDirectory(context);
        yield* fileSystem.makeDirectory(`${root}/Default/Network`, { recursive: true });
        yield* fileSystem.writeFileString(`${root}/Default/Network/Cookies`, "db");

        assert.deepEqual(yield* listSourceProfiles(helium, context), [
          { directory: "Default", name: "Default" },
        ]);
      }),
    ),
  );

  it.effect("counts a profile's cookies without decrypting them", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const paths = yield* withSourceHome();
        const root = helium.userDataDirectory(paths);
        yield* fileSystem.makeDirectory(`${root}/Default`, { recursive: true });
        yield* writeCookieDatabase(`${root}/Default/Cookies`, 3);

        const [profile] = yield* listSourceProfiles(helium, paths);
        assert.equal(profile?.cookieCount, 3);
      }),
    ),
  );
});

describe("cookieDatabaseCandidatePaths", () => {
  it.effect("prefers Network/Cookies and falls back to legacy Cookies", () =>
    run(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const context = yield* withSourceHome();
        const candidates = cookieDatabaseCandidatePaths(helium, context, "Default");
        assert.deepEqual(candidates, [
          path.join(
            context.home,
            "Library/Application Support/net.imput.helium/Default/Network/Cookies",
          ),
          path.join(context.home, "Library/Application Support/net.imput.helium/Default/Cookies"),
        ]);
      }),
    ),
  );

  it.effect("returns only cookies.sqlite for Firefox", () =>
    run(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const context = yield* sourcePathContext.pipe(
          Effect.provideService(HostProcessEnvironment, { HOME: "/tmp/test" }),
          Effect.provideService(HostProcessPlatform, "darwin"),
        );
        const candidates = cookieDatabaseCandidatePaths(firefox, context, "Profiles/abc.default");
        assert.deepEqual(candidates, [
          path.join(
            "/tmp/test",
            "Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite",
          ),
        ]);
      }),
    ),
  );
});

const firefox = BROWSER_IMPORT_SOURCES.find((source) => source.id === "firefox")!;

describe("isSourceRunning for Firefox", () => {
  it.effect("finds the lock inside the profile, not at the root", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-firefox-" });
        const context = yield* sourcePathContext.pipe(
          Effect.provideService(HostProcessEnvironment, { HOME: home }),
          Effect.provideService(HostProcessPlatform, "darwin"),
        );
        const root = firefox.userDataDirectory(context)!;
        const profile = `${root}/Profiles/abcd.default-release`;
        yield* fileSystem.makeDirectory(profile, { recursive: true });
        yield* fileSystem.writeFileString(`${profile}/cookies.sqlite`, "db");

        assert.isFalse(yield* isSourceRunning(firefox, context));

        // Firefox keeps its locks per profile. A root-level lock is not one,
        // and looking there was why a running Firefox read as importable.
        yield* fileSystem.writeFileString(`${root}/lock`, "");
        assert.isFalse(yield* isSourceRunning(firefox, context));

        yield* fileSystem.writeFileString(`${profile}/.parentlock`, "");
        assert.isTrue(yield* isSourceRunning(firefox, context));
      }),
    ),
  );

  it.effect("does not treat a stale parent.lock file as a running browser", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-firefox-" });
        const context = yield* sourcePathContext.pipe(
          Effect.provideService(HostProcessEnvironment, { HOME: home }),
          Effect.provideService(HostProcessPlatform, "win32"),
        );
        const root = firefox.userDataDirectory(context)!;
        const profile = `${root}/Profiles/gx7x7fqx.default-release`;
        yield* fileSystem.makeDirectory(profile, { recursive: true });
        yield* fileSystem.writeFileString(`${profile}/cookies.sqlite`, "db");

        // On Windows, Firefox creates parent.lock as a regular file that
        // persists after the process exits. The file is only locked while
        // Firefox is running; the old stat-based check always found it.
        yield* fileSystem.writeFileString(`${profile}/parent.lock`, "");
        assert.isFalse(yield* isSourceRunning(firefox, context));
      }),
    ),
  );
});

describe("Windows user-data directories", () => {
  it.effect("does not support any Chromium fork on win32", () =>
    Effect.gen(function* () {
      // No Chromium fork lists win32 anymore: since Chrome 127 their cookies
      // are App-Bound Encrypted, so nothing can import them. Omitting the
      // platform is what makes `unavailableReason` report `unsupportedPlatform`,
      // hiding these sources like Arc and Helium.
      for (const source of BROWSER_IMPORT_SOURCES) {
        if (source.engine === "chromium") {
          assert.notInclude(source.platforms, "win32");
        }
      }
    }),
  );
});

describe("listSourceProfiles hardening", () => {
  it.effect("drops profile directories that are not a single plain segment", () =>
    run(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const context = yield* withSourceHome();
        // `Local State` is writable by anything running as the user, so a
        // crafted key must not reach `cookieDatabasePath` and read a database
        // outside the browser's user-data directory.
        yield* fileSystem.writeFileString(
          `${userDataDirectory(context)}/Local State`,
          `{"profile":{"info_cache":{"Default":{"name":"You"},"../../../../secrets":{"name":"Escape"},"a/b":{"name":"Nested"},"..":{"name":"Parent"}}}}`,
        );

        const profiles = yield* listSourceProfiles(helium, context);

        assert.deepEqual(
          profiles.map((profile) => profile.directory),
          ["Default"],
        );
      }),
    ),
  );
});
