/**
 * UsageService - scans provider transcripts and returns priced usage buckets.
 *
 * The scan reads native session files and databases, including work driven
 * outside T3 Code. Cursor's local records provide only partial coverage.
 *
 * JSONL transcripts are append-only, so parsed records are memoised per file by
 * `(size, mtime)`. A cold 30-day scan of ~1.4 GB lands around 2-3 seconds; warm
 * scans only reparse files that changed, and a file that merely grew resumes
 * from its cached parse position so only the appended bytes are read.
 * OpenCode's SQLite reader queries the live database each scan so WAL writes
 * remain visible. Antigravity databases are memoised in memory while the
 * database and its WAL keep the same `(size, mtime, ctime)`.
 *
 * Cursor's account API is slow, so its source answers from a cache and marks
 * itself `refreshing` while a background refresh runs; `awaitRefresh` waits
 * for that refresh instead. See `cursorAccountCache`.
 *
 * @module UsageService
 */
import * as NodeOS from "node:os";

import {
  ClaudeSettings,
  CodexSettings,
  ProviderInstanceId,
  USAGE_CONTRACT_VERSION,
  type ServerSettings as ServerSettingsValue,
  type UsageProviderKind,
  type UsageSource,
  type UsagePricing,
  type UsageSummary,
  type UsageSummaryInput,
  UsageReadError,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientResponse } from "effect/http";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath } from "../pathExpansion.ts";
import * as ServerSettings from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "../provider/ProviderInstanceRegistryHydration.ts";
import { hasEnabledCursorInstance } from "./cursorAppData.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
import { listProviderHomeCandidates, scanHomePath } from "./usageHomes.ts";
import { readOpenCodeUsage as readOpenCodeNativeUsage } from "./opencodeUsageReader.ts";
import { makeAntigravityUsageCache, readAntigravityUsage } from "./antigravityUsageReader.ts";
import {
  CURSOR_ACCOUNT_CACHE_FILE_NAME,
  CURSOR_ACCOUNT_TTL_MS,
  cursorFetchRange,
  decodeCursorAccountCaches,
  encodeCursorAccountCaches,
  isCursorCacheFresh,
  mergeCursorFetch,
  type CursorAccountCache,
  type CursorCredentialSource,
} from "./cursorAccountCache.ts";
import * as CursorUsageReader from "./cursorUsageReader.ts";
import { resolveModelAliases, UsageAggregator } from "./usageAggregation.ts";
import { projectUsageSummaryForClient } from "./usageClientCompat.ts";
import { loadCursorUsageRecords, type CursorExportLoadResult } from "./usageCursorExport.ts";
import { createOverrideRateTable, parseRateTable, type RateTable } from "./usagePricing.ts";
import { readOpenCodeUsage, resolveOpenCodeDatabasePaths } from "./usageOpenCode.ts";
import {
  listTranscriptFiles,
  readDirectoryVolumeId,
  readTranscriptRecords,
} from "./usageTranscriptReader.ts";
import {
  decodeScanCache,
  dedupeWithinFile,
  LEGACY_SCAN_CACHE_FILE_NAME,
  makeScanCacheWriter,
  pruneScanCache,
  SCAN_CACHE_FILE_NAME,
  type CachedFile,
  type ScanCache,
} from "./usageScanCache.ts";
import type { TranscriptProviderKind, UsageRecord } from "./usageTranscripts.ts";

const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Rates move rarely; a day-old table keeps the page working offline. */
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

/** An explicit refresh ignores the TTL, but not a table fetched this recently. */
const RATES_REFRESH_FLOOR_MS = 60 * 1000;

/**
 * Files are filtered by mtime before opening. The slack covers a session whose
 * last write lands just before local midnight on the window's first day.
 */
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const MAX_HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The longest window the UI offers, 90 days, plus its `MTIME_SLACK_MS`, rounded
 * up. Older entries are pruned.
 */
const CACHE_RETENTION_DAYS = 92;

const CURSOR_ACCOUNT_READ_ERROR = "Cursor account usage could not be read.";

function toCursorUsageSource(result: CursorExportLoadResult, distinctSessions = 0): UsageSource {
  const accountKey =
    result.userId !== null ? CursorUsageReader.cursorAccountKey(result.userId) : "";
  const resolvedHomePath = accountKey ? `cursor-account:${accountKey}` : "cursor-export";
  // Cursor export is account-scoped, not host-local. A fixed host/volume keeps
  // the same Cursor login from double-counting across machines.
  const fingerprint = {
    hostId: "cursor.com",
    provider: "cursor" as const,
    resolvedHomePath,
    volumeId: accountKey,
  };
  if (result.status === "ok") {
    return {
      fingerprint,
      status: "ok",
      scannedFiles: result.fromCache ? 0 : 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions,
      message: result.fromCache ? "Served from cached Cursor usage export." : null,
    };
  }
  return {
    fingerprint,
    status: result.status,
    scannedFiles: 0,
    skippedFiles: 0,
    malformedRecords: 0,
    distinctSessions: 0,
    message: result.message,
  };
}

/** Transcripts parsed at once. More gains little once the disk stays busy. */
const TRANSCRIPT_READ_CONCURRENCY = 4;

/** On-disk shape of the rate snapshot. */
const RatesCacheFile = Schema.Struct({
  fetchedAtMs: Schema.Number,
  document: Schema.Unknown,
});
const decodeRatesCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);
const encodeRatesCache = Schema.encodeEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);

/** The scan cache is narrowed by hand in `usageScanCache`, so JSON is enough here. */
const ScanCacheJson = Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>);
const decodeScanCacheFile = Schema.decodeUnknownEffect(ScanCacheJson);
const encodeUsageRecordKey = Schema.encodeSync(ScanCacheJson);
const CachedSource = Schema.Struct({ dir: Schema.String, volumeId: Schema.String });

/** Whether `a` read a later state of its file than `b`. Transcripts only grow. */
function isLaterRead(a: CachedFile, b: CachedFile): boolean {
  return a.mtimeMs > b.mtimeMs || (a.mtimeMs === b.mtimeMs && a.size > b.size);
}

/**
 * Codex sessions with records in more than one file, such as a rollout that
 * moved after it was read. Only these need cross-file dedupe keys: within one
 * file the occurrence count already keeps every key unique, so keying the rest
 * would only build and hash a string for each of their records.
 */
function sharedCodexSessions(
  files: readonly { readonly records: readonly UsageRecord[] }[],
): ReadonlySet<string> {
  const firstFile = new Map<string, number>();
  const shared = new Set<string>();
  for (const [index, file] of files.entries()) {
    let previous = "";
    for (const { provider, sessionId } of file.records) {
      if (provider !== "codex" || sessionId === previous || sessionId.length === 0) continue;
      previous = sessionId;
      const first = firstFile.get(sessionId);
      if (first === undefined) firstFile.set(sessionId, index);
      else if (first !== index) shared.add(sessionId);
    }
  }
  return shared;
}
const decodeCachedSources = Schema.decodeUnknownOption(
  Schema.Struct({ sources: Schema.Record(Schema.String, CachedSource) }),
);

export function readGrokHomeOverride(environment: NodeJS.ProcessEnv): string | undefined {
  const value = environment["GROK_HOME"]?.trim();
  return value === "" ? undefined : value;
}

const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);

export class UsageService extends Context.Service<
  UsageService,
  {
    readonly readSummary: (input: UsageSummaryInput) => Effect.Effect<UsageSummary, UsageReadError>;
    /** Refetches the rate table ahead of its TTL. See `ensureRates`. */
    readonly refreshRates: Effect.Effect<UsagePricing>;
  }
>()("t3/usage/UsageService") {}

const EMPTY_PRICING: UsagePricing = {
  status: "unavailable",
  source: LITELLM_RATES_URL,
  fetchedAt: null,
  knownModels: 0,
};

/** Empty summary, for suites that only need the RPC surface to resolve. */
const layerTest = Layer.succeed(
  UsageService,
  UsageService.of({
    readSummary: (input) =>
      Effect.succeed(
        projectUsageSummaryForClient(
          {
            contractVersion: USAGE_CONTRACT_VERSION,
            readAt: "1970-01-01T00:00:00.000Z",
            timeZone: input.timeZone,
            sinceDay: input.sinceDay,
            untilDay: input.untilDay,
            buckets: [],
            sources: [],
            pricing: EMPTY_PRICING,
            scanDurationMs: 0,
          },
          input.clientContractVersion,
        ),
      ),
    refreshRates: Effect.succeed(EMPTY_PRICING),
  }),
);

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const hostEnvironment = yield* HostProcessEnvironment;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const platform = yield* HostProcessPlatform;
  const cursorAccountReader = yield* CursorUsageReader.CursorAccountReader;

  const fileCache: ScanCache = new Map();
  const antigravityCache = makeAntigravityUsageCache();
  const sourceCache = new Map<string, typeof CachedSource.Type>();
  let cacheDirty = false;
  /** Cursor account caches by credential source. */
  const cursorCaches = new Map<string, CursorAccountCache>();
  let cursorCacheDirty = false;
  /**
   * The last failed refresh per credential source, standing for a TTL so a
   * client refetching a broken login does not refetch Cursor each time. A
   * `null` error means there is no login: no source to report.
   */
  const cursorFailures = new Map<
    string,
    { readonly atMs: number; readonly error: string | null }
  >();
  /** The refresh in flight per credential source, which every read joins. */
  const cursorRefreshes = new Map<string, Deferred.Deferred<void>>();
  const isWithinDirectory = (filePath: string, dir: string) => {
    const relative = path.relative(dir, filePath);
    return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  };

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, SCAN_CACHE_FILE_NAME);
  const legacyScanCachePath = path.join(config.stateDir, LEGACY_SCAN_CACHE_FILE_NAME);
  const cursorCachePath = path.join(config.stateDir, CURSOR_ACCOUNT_CACHE_FILE_NAME);
  const cursorExportCacheDir = config.stateDir;
  const writeCacheFile = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: UsagePricing["status"] = "unavailable";
  // One fetch at a time. A burst of refreshes from several clients waits on
  // the first fetch and then sees a table young enough to skip its own.
  const ratesLock = yield* Semaphore.make(1);

  const pricing = (): UsagePricing => ({
    status: ratesStatus,
    source: LITELLM_RATES_URL,
    fetchedAt:
      ratesFetchedAtMs === null ? null : DateTime.formatIso(DateTime.makeUnsafe(ratesFetchedAtMs)),
    knownModels: rates.size,
  });

  /**
   * Loads the LiteLLM rate table, preferring a fresh copy and falling back to
   * the on-disk snapshot. With neither, every model reports as unpriced rather
   * than the page failing. `force` refetches inside the TTL so a model that
   * LiteLLM added since the last fetch gets priced now.
   */
  const loadRates = Effect.fn("UsageService.loadRates")(function* (force: boolean) {
    const now = yield* Clock.currentTimeMillis;
    const maxAgeMs = force ? RATES_REFRESH_FLOOR_MS : RATES_TTL_MS;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < maxAgeMs) return;

    if (ratesFetchedAtMs === null) {
      const fromDisk = yield* fileSystem.readFileString(ratesCachePath).pipe(
        Effect.flatMap((raw) => decodeRatesCache(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (fromDisk !== null) {
        const parsed = parseRateTable(fromDisk.document);
        if (parsed.size > 0) {
          rates = parsed;
          ratesFetchedAtMs = fromDisk.fetchedAtMs;
          ratesStatus = "cached";
          if (now - fromDisk.fetchedAtMs < maxAgeMs) return;
        }
      }
    }

    const fetched = yield* httpClient.get(LITELLM_RATES_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(10_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) {
      // The refresh failed; whatever we are serving is now past its TTL and
      // must not keep claiming to be fresh.
      if (rates.size > 0) ratesStatus = "cached";
      return;
    }

    const parsed = parseRateTable(fetched);
    if (parsed.size === 0) return;

    rates = parsed;
    ratesFetchedAtMs = now;
    ratesStatus = "fresh";

    yield* encodeRatesCache({ fetchedAtMs: now, document: fetched }).pipe(
      Effect.flatMap((contents) => writeCacheFile(ratesCachePath, contents)),
      Effect.ignoreCause,
    );
  });

  const ensureRates = (force: boolean) => ratesLock.withPermit(loadRates(force));

  const refreshRates = ensureRates(true).pipe(
    Effect.map(pricing),
    Effect.withSpan("UsageService.refreshRates"),
  );

  // A settings failure must not silently discard custom rates or transcript homes.
  const readSettings = settingsService.getSettings.pipe(
    Effect.catchCause(
      (cause) =>
        new UsageReadError({
          reason: "scanFailed",
          detail: "Server settings could not be read.",
          cause: Cause.squash(cause),
        }),
    ),
  );

  /**
   * Resolves the transcript directories for each provider, one per configured
   * provider instance. Instances that share a home (shadow homes symlink
   * `sessions` back into the shared home) collapse to a single directory.
   */
  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* (
    settings: ServerSettingsValue,
    retentionCutoffMs: number,
  ) {
    type JsonlSource = {
      readonly provider: TranscriptProviderKind;
      readonly dir: string;
      readonly volumeId: string;
      readonly kind: "jsonl";
    };
    type OpenCodeSource = {
      readonly provider: "opencode";
      readonly dir: string;
      readonly databasePaths: readonly string[];
      readonly kind: "opencodeSqlite";
      readonly resolvedHomePath: string;
    };

    const dirs: Array<JsonlSource | OpenCodeSource> = [];
    const seen = new Set<string>();
    // Two instances can point at one physical directory through symlinks
    // (or macOS's /tmp → /private/tmp). Canonicalising before de-duplication
    // stops the same transcripts being counted once per alias. A directory
    // that does not resolve (typically: does not exist) keeps its last known
    // canonical path, falling back to the configured one, and is reported as
    // missing further down.
    const pushJsonl = (provider: TranscriptProviderKind, configuredDir: string) =>
      Effect.gen(function* () {
        const directory = path.resolve(configuredDir);
        const sourceKey = provider + "\0" + directory;
        const previous = sourceCache.get(sourceKey);
        // Keep canonical paths and source fingerprints stable after root cleanup,
        // including aliases and clients merging pre-cleanup environment summaries.
        const dir = yield* fileSystem
          .realPath(directory)
          .pipe(Effect.catchCause(() => Effect.succeed(previous?.dir ?? directory)));
        const currentVolumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
        const hasRetainedHistory = fileCache
          .entries()
          .some(
            ([filePath, entry]) =>
              entry.provider === provider &&
              entry.mtimeMs >= retentionCutoffMs &&
              entry.records.length + entry.tailRecords.length > 0 &&
              isWithinDirectory(filePath, dir),
          );
        // A recreated directory still reports the retained history under its old identity.
        const volumeId =
          previous?.dir === dir && (hasRetainedHistory || !currentVolumeId)
            ? previous.volumeId || currentVolumeId
            : currentVolumeId;
        if (previous?.dir !== dir || previous.volumeId !== volumeId) {
          sourceCache.set(sourceKey, { dir, volumeId });
          cacheDirty = true;
        }
        const key = `${provider}\0${dir}`;
        if (seen.has(key)) return;
        seen.add(key);
        dirs.push({ provider, dir, volumeId, kind: "jsonl" });
      });

    for (const candidate of listProviderHomeCandidates(settings, "claude", hostEnvironment)) {
      // A blob that fails to decode belongs to an instance the registry
      // already reports as unavailable; the scan skips it.
      const config = yield* decodeClaudeSettings(candidate.config).pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (config === null) continue;
      const configuredHome = scanHomePath(config.homePath, candidate.homeEnvValue, false);
      // An instance that configures neither a home path nor `CLAUDE_CONFIG_DIR`
      // runs against Claude's default config dir. Transcripts always live in
      // `<home>/projects`.
      const claudeHome =
        configuredHome.trim().length > 0
          ? yield* resolveClaudeHomePath({ homePath: configuredHome })
          : path.join(NodeOS.homedir(), ".claude");
      yield* pushJsonl("claude", path.join(claudeHome, "projects"));
    }

    for (const candidate of listProviderHomeCandidates(settings, "codex", hostEnvironment)) {
      const config = yield* decodeCodexSettings(candidate.config).pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (config === null) continue;
      const layout = yield* resolveCodexHomeLayout({
        ...config,
        homePath: scanHomePath(
          config.homePath,
          // A managed ChatGPT account owns its home; CODEX_HOME does not redirect it.
          config.setupMode === "managed" ? null : candidate.homeEnvValue,
          config.shadowHomePath.trim().length > 0,
        ),
      });
      yield* pushJsonl("codex", path.join(layout.sharedHomePath, "sessions"));
    }

    // Grok has no home blob in its driver config, so each instance relocates
    // its home purely through `GROK_HOME` in its own spawn environment. The
    // legacy default slot inherits the server's environment, mirroring
    // `listProviderHomeCandidates` for the other providers.
    const grokEnvironments: Array<NodeJS.ProcessEnv> = [];
    let grokDefaultSlotClaimed = false;
    for (const [instanceId, envelope] of Object.entries(settings.providerInstances)) {
      // Any entry occupying the default slot claims it, even one for another
      // driver: the registry suppresses the legacy blob in that case too.
      if (instanceId === "grok") grokDefaultSlotClaimed = true;
      if (envelope.driver !== "grok") continue;
      grokEnvironments.push(
        mergeProviderInstanceEnvironment(envelope.environment, hostEnvironment),
      );
    }
    if (!grokDefaultSlotClaimed) grokEnvironments.push(hostEnvironment);
    for (const grokEnvironment of grokEnvironments) {
      const grokHome = path.resolve(
        expandHomePath(
          readGrokHomeOverride(grokEnvironment) ?? path.join(NodeOS.homedir(), ".grok"),
        ),
      );
      yield* pushJsonl("grok", path.join(grokHome, "sessions"));
    }

    // Read through the injected host environment, the way the claude, codex and
    // grok scans already do. Reaching for `process.env` here meant a caller that
    // supplied its own environment still had OpenCode scanned out of the real
    // user's `~/.local/share`, which is also why these tests read real data.
    const openCodeDataDir = path.join(
      hostEnvironment.XDG_DATA_HOME?.trim() ||
        path.join(hostEnvironment.HOME?.trim() || NodeOS.homedir(), ".local", "share"),
      "opencode",
    );
    const openCodeDatabaseOverride = hostEnvironment.OPENCODE_DB?.trim() || undefined;
    const disableOpenCodeChannelDatabase = hostEnvironment.OPENCODE_DISABLE_CHANNEL_DB?.trim();
    const shouldDiscoverOpenCodeDatabases =
      !openCodeDatabaseOverride &&
      !["1", "true"].includes(disableOpenCodeChannelDatabase?.toLowerCase() ?? "");
    const openCodeDirectoryEntries = shouldDiscoverOpenCodeDatabases
      ? yield* fileSystem
          .readDirectory(openCodeDataDir)
          .pipe(Effect.catchCause(() => Effect.succeed([] as string[])))
      : [];
    const openCodeDatabasePaths = resolveOpenCodeDatabasePaths({
      dataDir: openCodeDataDir,
      databaseOverride: openCodeDatabaseOverride,
      disableChannelDatabase: disableOpenCodeChannelDatabase,
      directoryEntries: openCodeDirectoryEntries,
      path,
    });
    const openCodeResolvedHomePath =
      openCodeDatabaseOverride !== undefined
        ? (openCodeDatabasePaths[0] ?? ":memory:")
        : openCodeDataDir;
    const openCodeVolumeDir = openCodeDatabasePaths[0]
      ? path.dirname(openCodeDatabasePaths[0])
      : openCodeDataDir;
    if (
      openCodeDatabaseOverride ||
      ["1", "true"].includes(disableOpenCodeChannelDatabase?.toLowerCase() ?? "")
    )
      dirs.push({
        provider: "opencode",
        dir: openCodeVolumeDir,
        databasePaths: openCodeDatabasePaths,
        kind: "opencodeSqlite",
        resolvedHomePath: openCodeResolvedHomePath,
      });

    return dirs;
  });

  /**
   * Loads the persisted scan and Cursor account caches exactly once per process.
   *
   * `Effect.cached` makes concurrent first readers await the same load rather
   * than each seeing a "loaded" flag set before the read finished and cold
   * scanning against an empty cache.
   */
  const ensureScanCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const readDocument = (filePath: string) =>
        fileSystem.readFileString(filePath).pipe(
          Effect.flatMap((raw) => decodeScanCacheFile(raw)),
          Effect.catchCause(() => Effect.succeed(null)),
        );
      for (const [key, cache] of decodeCursorAccountCaches(yield* readDocument(cursorCachePath))) {
        cursorCaches.set(key, cache);
      }
      let document = yield* readDocument(scanCachePath);
      if (document === null) {
        document = yield* readDocument(legacyScanCachePath);
        // Write the migrated cache to its own file on the next scan.
        cacheDirty = document !== null;
      }
      if (document === null) return;
      for (const [path, entry] of decodeScanCache(document)) fileCache.set(path, entry);
      const sources = decodeCachedSources(document);
      if (Option.isSome(sources)) {
        for (const [key, source] of Object.entries(sources.value.sources))
          sourceCache.set(key, source);
      }
    }),
  );

  const writeScanCache = makeScanCacheWriter();
  // Scans with different windows can finish together; serializing the writes
  // keeps an older snapshot from landing after a newer one.
  const persistLock = yield* Semaphore.make(1);

  // Each dirty flag is cleared before encoding, so a change while the write is
  // in flight marks it dirty again. A failed write restores the flag, so the
  // next persist retries instead of leaving disk stale. A cache we cannot
  // write is a slower next start, not a failed read.
  const persistCaches = Effect.gen(function* () {
    if (cacheDirty) {
      cacheDirty = false;
      yield* Effect.sync(() =>
        writeScanCache(fileCache, { sources: Object.fromEntries(sourceCache) }),
      ).pipe(
        Effect.flatMap((contents) => writeCacheFile(scanCachePath, contents)),
        Effect.catchCause(() =>
          Effect.sync(() => {
            cacheDirty = true;
          }),
        ),
      );
    }
    if (cursorCacheDirty) {
      cursorCacheDirty = false;
      yield* Effect.sync(() => encodeCursorAccountCaches(cursorCaches)).pipe(
        Effect.flatMap((contents) => writeCacheFile(cursorCachePath, contents)),
        Effect.catchCause(() =>
          Effect.sync(() => {
            cursorCacheDirty = true;
          }),
        ),
      );
    }
  }).pipe(persistLock.withPermit, Effect.withSpan("UsageService.persistCaches"));

  const pendingPersists = new Set<Fiber.Fiber<void>>();
  /** Writes dirty caches in the background, after the summary that dirtied them answers. */
  const schedulePersist = Effect.forkDetach(persistCaches).pipe(
    Effect.map((fiber) => {
      pendingPersists.add(fiber);
      fiber.addObserver(() => pendingPersists.delete(fiber));
    }),
  );
  /** Waits for every write scheduled so far, as a restart would need. */
  const awaitPersisted = Effect.suspend(() => Fiber.awaitAll([...pendingPersists])).pipe(
    Effect.asVoid,
  );
  // A write still running when the service shuts down finishes first, so the
  // next start does not lose the last scan.
  yield* Effect.addFinalizer(() => awaitPersisted);

  /**
   * Parses one transcript, reusing the cached result when it is unchanged.
   *
   * A file that only grew re-parses from the cached position, so an actively
   * written multi-hundred-megabyte rollout costs its appended bytes per scan
   * rather than a full re-read. The reader verifies the position's guard bytes
   * and silently restarts from byte 0 when they no longer match.
   *
   * A fresh parse comes back as `update` for the caller to cache, with the
   * entry it was built from. Reads run concurrently, and the caller stores
   * updates in walk order rather than completion order: saved records of
   * deleted transcripts aggregate in cache order, where the first copy of a
   * duplicate wins.
   */
  const readFileRecords = (
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: TranscriptProviderKind,
  ): Effect.Effect<{
    readonly records: readonly UsageRecord[];
    readonly update?: { readonly entry: CachedFile; readonly replaces: CachedFile | undefined };
  }> =>
    Effect.gen(function* () {
      const cached = fileCache.get(filePath);
      // Provider is part of the identity: if both providers were ever pointed
      // at one directory, a hit parsed by the other parser must not be reused.
      if (
        cached &&
        cached.size === size &&
        cached.mtimeMs === mtimeMs &&
        cached.provider === provider
      ) {
        return {
          records:
            cached.tailRecords.length === 0
              ? cached.records
              : [...cached.records, ...cached.tailRecords],
        };
      }

      // Only a strictly grown file may resume. Same size with a new mtime, or
      // a shrunken file, means rewritten content; re-parse it whole.
      const resumeFrom =
        cached !== undefined && cached.provider === provider && size > cached.size
          ? cached.position
          : undefined;

      const parsed = yield* Effect.promise(() =>
        readTranscriptRecords(filePath, provider, resumeFrom),
      );
      // A read failure is not an empty transcript: caching it under this
      // (size, mtime) would silently drop the file's usage until it changes.
      if (parsed === null)
        return {
          records: cached?.provider === provider ? [...cached.records, ...cached.tailRecords] : [],
        };

      // Stored already de-duplicated within the file, which is 99% of all
      // duplicates. The aggregator still runs the cross-file dedupe pass. One
      // seen set spans the cached base, the new lines, and the tail so a
      // resumed parse dedupes exactly like a full one.
      const base = parsed.resumed && cached !== undefined ? cached.records : [];
      const seen = new Set<string>();
      const records = dedupeWithinFile([...base, ...parsed.records], seen);
      const tailRecords = dedupeWithinFile(parsed.tailRecords, seen);

      return {
        records: tailRecords.length === 0 ? records : [...records, ...tailRecords],
        update: {
          entry: { size, mtimeMs, provider, records, tailRecords, position: parsed.position },
          replaces: cached,
        },
      };
    });

  /** One provider source's walk and parse, before rates are involved. */
  type ScannedSource = (
    | {
        readonly kind?: "jsonl";
        readonly provider: UsageProviderKind;
        readonly dir: string;
        readonly volumeId: string;
        readonly resolvedHomePath?: string;
        /** Parsed records per file, or `null` when the directory does not exist. */
        readonly files:
          | readonly { readonly path: string; readonly records: readonly UsageRecord[] }[]
          | null;
      }
    | {
        readonly kind: "opencodeSqlite";
        readonly provider: "opencode";
        readonly dir: string;
        readonly volumeId: string;
        readonly resolvedHomePath?: string;
        /** Databases that exist on disk; empty when OpenCode has no ledger here. */
        readonly databasePaths: readonly string[];
      }
  ) & {
    readonly hostId?: string;
    readonly status?: UsageSource["status"];
    readonly message?: string;
    readonly action?: UsageSource["action"];
    /** Answered from a cache while a refresh runs. */
    readonly refreshing?: true;
  };

  /**
   * Keeps only the OpenCode ledger databases that exist on disk. The records
   * are read during aggregation, so the database list is all a scan carries.
   */
  const scanOpenCodeSqlite = Effect.fn("UsageService.scanOpenCodeSqlite")(function* (source: {
    readonly provider: "opencode";
    readonly dir: string;
    readonly databasePaths: readonly string[];
    readonly resolvedHomePath: string;
  }) {
    const { dir } = source;
    const volumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
    const databasePaths: string[] = [];
    for (const databasePath of source.databasePaths) {
      const databaseExists = yield* fileSystem
        .exists(databasePath)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (databaseExists) databasePaths.push(databasePath);
    }
    return {
      kind: "opencodeSqlite",
      provider: source.provider,
      dir,
      volumeId,
      resolvedHomePath: source.resolvedHomePath,
      databasePaths,
    } satisfies ScannedSource;
  });

  const scanTranscriptDir = Effect.fn("UsageService.scanTranscriptDir")(function* (
    source: {
      readonly provider: TranscriptProviderKind;
      // Resolved (and kept stable across transcript cleanup) by resolveTranscriptDirs.
      readonly dir: string;
      readonly volumeId: string;
    },
    windowStartMs: number,
  ) {
    const { provider, dir, volumeId } = source;
    const exists = yield* fileSystem
      .exists(dir)
      .pipe(Effect.catchCause(() => Effect.succeed(false)));
    if (!exists) {
      return {
        kind: "jsonl",
        provider,
        dir,
        volumeId,
        resolvedHomePath: dir,
        files: null,
      } satisfies ScannedSource;
    }
    const files = yield* Effect.promise(() =>
      listTranscriptFiles(
        dir,
        windowStartMs,
        // Grok keeps usage only in `updates.jsonl`; its other logs are large.
        provider === "grok" ? { fileName: "updates.jsonl" } : undefined,
      ),
    );
    // A cold parse waits on disk reads, so a few files in flight read
    // close to twice as fast. Results keep walk order.
    const read = yield* Effect.forEach(
      files,
      (file) =>
        readFileRecords(file.path, file.size, file.mtimeMs, provider).pipe(
          Effect.map((result) => ({ path: file.path, ...result })),
        ),
      { concurrency: TRANSCRIPT_READ_CONCURRENCY },
    );
    const parsedFiles = read.map(({ path, records, update }) => {
      if (update === undefined) return { path, records };
      // A scan of another window may have cached its own read of this file
      // meanwhile. Then keep whichever read saw the later file, so a slower
      // scan never replaces newer usage with older.
      const current = fileCache.get(path);
      if (
        current === update.replaces ||
        current === undefined ||
        !isLaterRead(current, update.entry)
      ) {
        fileCache.set(path, update.entry);
        cacheDirty = true;
      }
      return { path, records };
    });
    return {
      kind: "jsonl",
      provider,
      dir,
      volumeId,
      resolvedHomePath: dir,
      files: parsedFiles,
    } satisfies ScannedSource;
  });

  /** Fetches what one account cache is missing, then persists it if anything changed. */
  const refreshCursorAccount = Effect.fn("UsageService.refreshCursorAccount")(function* (
    credential: CursorCredentialSource,
    credentialKey: string,
    retentionStartMs: number,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const fetchMissing = (cache: CursorAccountCache | undefined) => {
      const range = cursorFetchRange(cache, retentionStartMs, nowMs);
      return cursorAccountReader
        .read(credential, range.sinceMs, range.untilMs)
        .pipe(Effect.map((result) => ({ range, result })));
    };
    let base = cursorCaches.get(credentialKey);
    let fetched = yield* fetchMissing(base);
    // Another login's history replaces the cached account's, even if reading it fails.
    if (
      base !== undefined &&
      fetched.result.accountKey !== null &&
      fetched.result.accountKey !== base.accountKey
    ) {
      cursorCaches.delete(credentialKey);
      cursorCacheDirty = true;
      base = undefined;
      fetched = yield* fetchMissing(base);
    }
    const { range, result } = fetched;
    if (result.missing || result.error !== null || result.accountKey === null) {
      cursorFailures.set(credentialKey, {
        atMs: nowMs,
        error: result.missing || result.error !== null ? result.error : CURSOR_ACCOUNT_READ_ERROR,
      });
      yield* schedulePersist;
      return;
    }
    const merged = mergeCursorFetch(
      base,
      result.accountKey,
      range,
      result.records,
      nowMs,
      retentionStartMs,
    );
    cursorCaches.set(credentialKey, merged.cache);
    cursorFailures.delete(credentialKey);
    // An unchanged edge is not worth rewriting the file for: after a restart
    // the cache just refetches a slightly wider edge.
    if (merged.changed) {
      cursorCacheDirty = true;
      yield* schedulePersist;
    }
  });

  /** Joins the refresh in flight, or starts one. */
  const startCursorRefresh = (
    credential: CursorCredentialSource,
    credentialKey: string,
    retentionStartMs: number,
  ) =>
    // Enrollment and fork are atomic, so an interrupted caller cannot leave a
    // registered refresh that nothing will finish.
    Effect.uninterruptible(
      Effect.gen(function* () {
        const current = cursorRefreshes.get(credentialKey);
        if (current !== undefined) return current;
        const done = Deferred.makeUnsafe<void>();
        cursorRefreshes.set(credentialKey, done);
        // Detached: a departing client must not cancel a fetch later reads reuse.
        yield* refreshCursorAccount(credential, credentialKey, retentionStartMs).pipe(
          Effect.catchCause(() =>
            Clock.currentTimeMillis.pipe(
              Effect.map((atMs) =>
                cursorFailures.set(credentialKey, { atMs, error: CURSOR_ACCOUNT_READ_ERROR }),
              ),
            ),
          ),
          Effect.ensuring(
            Effect.suspend(() => {
              cursorRefreshes.delete(credentialKey);
              return Deferred.succeed(done, undefined);
            }),
          ),
          Effect.forkDetach,
        );
        return done;
      }),
    );

  /**
   * The Cursor account source. A cache inside its TTL, or a refresh that failed
   * inside it, answers directly. Otherwise a refresh starts: `awaitRefresh`
   * waits for it, and anything else answers from the cache marked `refreshing`.
   */
  const cursorAccountSource = Effect.fn("UsageService.cursorAccountSource")(function* (
    credential: CursorCredentialSource,
    authPath: string,
    windowStartMs: number,
    retentionStartMs: number,
    awaitRefresh: boolean,
  ) {
    // No saved login means there is no account source to report, not a setup error.
    if (
      typeof credential === "string" &&
      !(yield* fileSystem.exists(credential).pipe(Effect.orElseSucceed(() => true)))
    ) {
      return null;
    }
    const credentialKey = typeof credential === "string" ? credential : "keychain";
    const nowMs = yield* Clock.currentTimeMillis;
    const recentFailure = cursorFailures.get(credentialKey);
    let refreshing = false;
    if (
      (recentFailure === undefined || nowMs - recentFailure.atMs >= CURSOR_ACCOUNT_TTL_MS) &&
      !isCursorCacheFresh(cursorCaches.get(credentialKey), nowMs)
    ) {
      const refresh = yield* startCursorRefresh(credential, credentialKey, retentionStartMs);
      if (awaitRefresh) yield* Deferred.await(refresh);
      else refreshing = true;
    }

    const cache = cursorCaches.get(credentialKey);
    const failure = refreshing ? undefined : cursorFailures.get(credentialKey);
    const failureMessage = failure === undefined ? undefined : failure.error;
    if (failureMessage === null) return null;
    if (cache === undefined) {
      return {
        provider: "cursor",
        dir: authPath,
        volumeId: yield* Effect.promise(() => readDirectoryVolumeId(authPath)),
        // Never combine a local fallback with another server's account-wide history.
        ...(refreshing
          ? { files: [], refreshing: true }
          : { files: null, message: failureMessage ?? CURSOR_ACCOUNT_READ_ERROR }),
      } satisfies ScannedSource;
    }
    // The same account includes CLI and desktop history from every machine.
    // A stable remote fingerprint prevents connected environments counting it twice.
    const source = `cursor-account:${cache.accountKey}`;
    return {
      provider: "cursor",
      dir: source,
      hostId: "cursor.com",
      volumeId: cache.accountKey,
      files: [
        {
          path: source,
          records: cache.records.filter((record) => record.timestampMs >= windowStartMs),
        },
      ],
      ...(failureMessage === undefined
        ? { status: "ok" }
        : { status: "partial", message: failureMessage }),
      ...(refreshing ? { refreshing: true } : {}),
    } satisfies ScannedSource;
  });

  const collectDirs = Effect.fn("UsageService.collectDirs")(function* (
    windowStartMs: number,
    settings: ServerSettingsValue,
    retentionCutoffMs: number,
    awaitRefresh: boolean,
  ) {
    // The home resolvers ask for `Path` themselves; satisfy them from the
    // instance we already hold so the scan stays context-free.
    const dirs = yield* resolveTranscriptDirs(settings, retentionCutoffMs).pipe(
      Effect.provideService(Path.Path, path),
    );

    const home = NodeOS.homedir();
    const envRoots = Effect.fnUntraced(function* (key: string, defaults: readonly string[]) {
      const roots = hostEnvironment[key]
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const canonical = new Set<string>();
      for (const root of roots?.length ? roots : defaults) {
        const resolved = path.resolve(expandHomePath(root));
        canonical.add(
          yield* fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved)),
        );
      }
      return [...canonical];
    });
    const dataHome = hostEnvironment["XDG_DATA_HOME"]?.trim();

    const openCode = Effect.gen(function* () {
      const roots = yield* envRoots("OPENCODE_DATA_DIR", [
        path.join(
          dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, ".local", "share"),
          "opencode",
        ),
      ]);
      // The fork's SQLite ledger source (OPENCODE_DB / channel DB disabled)
      // replaces the native directory read.
      if (dirs.some((source) => source.kind === "opencodeSqlite")) return [];
      return yield* Effect.forEach(
        roots,
        (dir) =>
          Effect.gen(function* () {
            const result = yield* Effect.promise(() =>
              readOpenCodeNativeUsage(dir, windowStartMs),
            );
            return {
              provider: "opencode",
              dir,
              volumeId: yield* Effect.promise(() => readDirectoryVolumeId(dir)),
              files: result.missing && !result.error ? null : result.files,
              status: result.error ? "partial" : "ok",
              ...(result.error ? { message: "Some OpenCode history could not be read." } : {}),
            } satisfies ScannedSource;
          }),
        { concurrency: "unbounded" },
      );
    });

    const antigravity = Effect.gen(function* () {
      const antigravityRoots = yield* envRoots("ANTIGRAVITY_DATA_DIR", [
        ...["antigravity", "antigravity-cli", "antigravity-ide", "antigravity-backup"].map((name) =>
          path.join(home, ".gemini", name),
        ),
        path.join(home, ".config", "antigravity"),
      ]);
      for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
        if (instance.driver === "antigravity") {
          const directories = yield* resolveAntigravityInstanceDirectories(
            config.stateDir,
            ProviderInstanceId.make(instanceId),
          ).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(Path.Path, path),
            Effect.mapError(
              (cause) =>
                new UsageReadError({
                  reason: "scanFailed",
                  detail: "Antigravity profile directory could not be resolved.",
                  cause,
                }),
            ),
          );
          antigravityRoots.push(path.join(directories.profile, "antigravity-acp"));
        }
      }
      const antigravityDirs = new Set<string>();
      for (const root of antigravityRoots) {
        const resolvedRoot = yield* fileSystem
          .realPath(root)
          .pipe(Effect.orElseSucceed(() => root));
        const nested = path.join(resolvedRoot, "conversations");
        const dir = (yield* fileSystem
          .exists(nested)
          .pipe(Effect.catchCause(() => Effect.succeed(false))))
          ? nested
          : resolvedRoot;
        antigravityDirs.add(yield* fileSystem.realPath(dir).pipe(Effect.orElseSucceed(() => dir)));
      }
      const result = yield* Effect.promise(() =>
        readAntigravityUsage([...antigravityDirs], windowStartMs, antigravityCache),
      );
      const scanned: ScannedSource[] = [];
      for (const dir of antigravityDirs) {
        const exists = yield* fileSystem
          .exists(dir)
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        const failed = result.errors.some(
          (error) => error === dir || error.startsWith(`${dir}${path.sep}`),
        );
        scanned.push({
          provider: "antigravity",
          dir,
          volumeId: yield* Effect.promise(() => readDirectoryVolumeId(dir)),
          files: !exists && !failed ? null : result.files.filter((file) => file.root === dir),
          status: failed ? "partial" : "ok",
          ...(failed ? { message: "Some Antigravity history could not be read." } : {}),
        });
      }
      return scanned;
    });

    const cursor = Effect.gen(function* () {
      const cursorUserHome =
        (platform === "win32" ? hostEnvironment["USERPROFILE"] : hostEnvironment["HOME"]) || home;
      const configHome = hostEnvironment["XDG_CONFIG_HOME"]?.trim();
      const cursorHome =
        platform === "darwin"
          ? path.join(cursorUserHome, "Library", "Application Support")
          : platform === "win32"
            ? hostEnvironment["APPDATA"] || path.join(cursorUserHome, "AppData", "Roaming")
            : configHome && path.isAbsolute(configHome)
              ? configHome
              : path.join(cursorUserHome, ".config");
      const cursorAuthPath =
        platform === "darwin"
          ? path.join(cursorUserHome, ".cursor", "auth.json")
          : path.join(cursorHome, platform === "win32" ? "Cursor" : "cursor", "auth.json");
      const credentialStore = hostEnvironment["AGENT_CLI_CREDENTIAL_STORE"];
      const loginUnavailable =
        Boolean(hostEnvironment["CURSOR_AUTH_TOKEN"]?.trim()) ||
        Boolean(hostEnvironment["CURSOR_API_KEY"]?.trim()) ||
        credentialStore === "memory";
      const useKeychain = platform === "darwin" && credentialStore !== "file";
      if (useKeychain && !loginUnavailable && !settings.cursorKeychainUsageEnabled) {
        return [
          {
            provider: "cursor",
            dir: cursorAuthPath,
            volumeId: "",
            files: null,
            message: "Cursor account usage is off on this environment.",
            action: "enableCursorKeychain",
          } satisfies ScannedSource,
        ];
      }
      if (loginUnavailable) {
        return [
          {
            provider: "cursor",
            dir: cursorAuthPath,
            volumeId: yield* Effect.promise(() => readDirectoryVolumeId(cursorAuthPath)),
            files: null,
            message: "Cursor account history needs a Cursor CLI login on this server.",
          } satisfies ScannedSource,
        ];
      }
      const source = yield* cursorAccountSource(
        useKeychain ? { kind: "keychain" } : cursorAuthPath,
        cursorAuthPath,
        windowStartMs,
        retentionCutoffMs,
        awaitRefresh,
      );
      return source === null ? [] : [source];
    });

    // Independent sources scan together. Transcript directories go one at a
    // time, so open files stay at `TRANSCRIPT_READ_CONCURRENCY`. The result
    // keeps this order, since aggregation keeps the first copy of a duplicate.
    const [transcripts, openCodeDirs, antigravityDirs, cursorDirs] = yield* Effect.all(
      [
        Effect.forEach(dirs, (source) =>
          Effect.gen(function* () {
            return source.kind === "opencodeSqlite"
              ? yield* scanOpenCodeSqlite(source)
              : yield* scanTranscriptDir(source, windowStartMs);
          }),
        ),
        openCode,
        antigravity,
        cursor,
      ],
      { concurrency: "unbounded" },
    );
    const scanned: readonly ScannedSource[] = [
      ...transcripts,
      ...openCodeDirs,
      ...antigravityDirs,
      ...cursorDirs,
    ];
    return scanned;
  });

  const scanSummary = Effect.fn("UsageService.scanSummary")(function* (
    input: UsageSummaryInput,
    settings: ServerSettingsValue,
  ) {
    if (input.sinceDay > input.untilDay) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is after untilDay '${input.untilDay}'`,
      });
    }

    let hourlyWindow: { readonly sinceTimeMs: number; readonly untilTimeMs: number } | null = null;
    if (input.resolution === "hour") {
      const sinceTime =
        input.sinceTime === undefined ? Option.none() : DateTime.make(input.sinceTime);
      const untilTime =
        input.untilTime === undefined ? Option.none() : DateTime.make(input.untilTime);
      if (Option.isNone(sinceTime) || Option.isNone(untilTime)) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Hourly usage requires valid sinceTime and untilTime instants",
        });
      }
      const sinceTimeMs = DateTime.toEpochMillis(sinceTime.value);
      const untilTimeMs = DateTime.toEpochMillis(untilTime.value);
      const durationMs = untilTimeMs - sinceTimeMs;
      if (durationMs <= 0 || durationMs > MAX_HOURLY_WINDOW_MS) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Hourly usage window must be greater than zero and at most 24 hours",
        });
      }
      hourlyWindow = { sinceTimeMs, untilTimeMs };
    }

    const startedAtMs = yield* Clock.currentTimeMillis;
    yield* ensureScanCacheLoaded;

    const hostId = NodeOS.hostname();
    const windowStart = DateTime.make(`${input.sinceDay}T00:00:00Z`);
    if (Option.isNone(windowStart)) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is not a valid date`,
      });
    }
    const windowStartMs =
      (hourlyWindow?.sinceTimeMs ?? DateTime.toEpochMillis(windowStart.value)) - MTIME_SLACK_MS;

    // Keep at least 90 days warm for short views, but never drop entries that
    // fall inside the window being walked (e.g. an "All" scan from 2020).
    const retentionCutoffMs = Math.min(
      windowStartMs,
      startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Pricing only matters once records are aggregated, so the rate table
    // loads while transcripts stream instead of gating them: a cold rates
    // fetch on a slow network no longer delays the scan by its own timeout.
    const [, scannedDirs] = yield* Effect.all(
      [
        ensureRates(false),
        collectDirs(windowStartMs, settings, retentionCutoffMs, input.awaitRefresh === true),
      ],
      { concurrency: 2 },
    );

    const aggregator = new UsageAggregator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      resolution: input.resolution ?? "day",
      ...hourlyWindow,
      rates,
      priceOverrides: createOverrideRateTable(settings.usagePriceOverrides),
      modelAliases: resolveModelAliases(settings.usageModelAliases),
    });

    const sources: UsageSource[] = [];

    // Cleanup may remove transcripts, but the usage we already saved still
    // contributes to its source through the normal aggregation and dedupe
    // path. Like the walk, skip files last written before the window: they
    // cannot hold records inside it.
    const retainedSinceMs = Math.max(windowStartMs, retentionCutoffMs);
    const filesByDir = scannedDirs.map((source) => {
      // OpenCode's SQLite ledger has no transcript files to retain.
      if (source.kind === "opencodeSqlite") return [];
      const { provider, dir, files } = source;
      const retainedFiles = [...(files ?? [])];
      const livePaths = new Set(retainedFiles.map((file) => file.path));
      for (const [filePath, entry] of fileCache) {
        if (
          entry.provider !== provider ||
          entry.mtimeMs < retainedSinceMs ||
          livePaths.has(filePath) ||
          !isWithinDirectory(filePath, dir)
        )
          continue;
        retainedFiles.push({ path: filePath, records: [...entry.records, ...entry.tailRecords] });
      }
      return retainedFiles;
    });
    const sharedSessions = sharedCodexSessions(filesByDir.flat());

    for (const [index, source] of scannedDirs.entries()) {
      const {
        provider,
        dir,
        volumeId,
        resolvedHomePath = source.dir,
        status,
        message,
        action,
        refreshing,
        hostId: sourceHostId,
      } = source;

      if (source.kind === "opencodeSqlite" && source.databasePaths.length === 0) {
        sources.push({
          fingerprint: { hostId, provider, resolvedHomePath, volumeId },
          status: "missing",
          scannedFiles: 0,
          skippedFiles: 0,
          malformedRecords: 0,
          distinctSessions: 0,
          message: "OpenCode usage database was not found.",
        });
        continue;
      }

      if (source.kind === "opencodeSqlite") {
        const sessionIds = new Set<string>();
        let scannedFiles = 0;
        let skippedFiles = 0;
        let malformedRecords = 0;
        for (const databasePath of source.databasePaths) {
          const result = yield* Effect.promise(() =>
            readOpenCodeUsage(databasePath, windowStartMs),
          );
          if (result === null) {
            skippedFiles += 1;
            continue;
          }

          scannedFiles += 1;
          malformedRecords += result.malformedRecords;
          for (const record of result.records) {
            if (aggregator.add(record) && record.sessionId.length > 0) {
              sessionIds.add(record.sessionId);
            }
          }
        }
        const status =
          scannedFiles === 0
            ? "failed"
            : skippedFiles > 0 || malformedRecords > 0
              ? "partial"
              : "ok";
        const message =
          scannedFiles === 0
            ? "OpenCode usage database could not be read."
            : skippedFiles > 0 && malformedRecords > 0
              ? "Some OpenCode usage databases and records could not be read."
              : skippedFiles > 0
                ? "Some OpenCode usage databases could not be read."
                : malformedRecords > 0
                  ? "Some OpenCode usage records could not be parsed."
                  : null;
        sources.push({
          fingerprint: { hostId, provider, resolvedHomePath, volumeId },
          status,
          scannedFiles,
          skippedFiles,
          malformedRecords,
          distinctSessions: sessionIds.size,
          message,
        });
        continue;
      }

      const files = source.files;
      let scannedFiles = 0;
      let skippedFiles = 0;
      // Distinct per directory. Buckets carry per-cell session counts, but a
      // session spans days and models, so clients total this figure instead.
      const sessionIds = new Set<string>();

      for (const file of filesByDir[index] ?? []) {
        if (file.records.length === 0) {
          skippedFiles += 1;
          continue;
        }
        scannedFiles += 1;
        const codexEventOccurrences = new Map<string, number>();
        for (const record of file.records) {
          let usageRecord = record;
          if (record.provider === "codex" && sharedSessions.has(record.sessionId)) {
            // Match moved rollout copies without collapsing repeated equal events
            // within one rollout (timestamps can have only second precision).
            // Only sessions seen in several files can have a copy to match.
            const key = encodeUsageRecordKey([
              record.provider,
              record.sessionId,
              record.timestampMs,
              record.model,
              record.totals,
            ]);
            const occurrence = (codexEventOccurrences.get(key) ?? 0) + 1;
            codexEventOccurrences.set(key, occurrence);
            usageRecord = { ...record, dedupeKey: key + ":" + occurrence };
          }
          // Only sessions contributing in-window count; the mtime slack can
          // admit boundary files whose records fall outside the range.
          if (aggregator.add(usageRecord, dir) && record.sessionId.length > 0) {
            sessionIds.add(record.sessionId);
          }
        }
      }

      sources.push({
        fingerprint: { hostId: sourceHostId ?? hostId, provider, resolvedHomePath, volumeId },
        // Clients exclude missing sources, so saved records remain an available source.
        status: files === null && scannedFiles === 0 ? "missing" : (status ?? "ok"),
        scannedFiles,
        skippedFiles,
        malformedRecords: 0,
        distinctSessions: sessionIds.size,
        message:
          message ?? (files === null ? "No transcript directory on this environment." : null),
        ...(action ? { action } : {}),
        ...(refreshing ? { refreshing } : {}),
      });
    }

    // Cursor has no local token transcripts; pull the dashboard CSV export
    // when Cursor desktop is signed in on this machine. Failures stay soft so
    // Claude/Codex still render.
    //
    // The export lives in Cursor's own application-support directory, which
    // macOS guards behind an "access data from other apps" prompt. Someone who
    // switched the Cursor driver off is not asking for that.
    const cursorEnabled = yield* settingsService.getSettings.pipe(
      Effect.map((settings) => hasEnabledCursorInstance(deriveProviderInstanceConfigMap(settings))),
      Effect.catchCause(() => Effect.succeed(true)),
    );
    // A cached account answer (even one whose refresh failed) or a refresh
    // still running already covers Cursor; the export would double-count it
    // or slow the fast first answer. The awaited refresh decides the fallback.
    const hasCursorAccountUsage = scannedDirs.some(
      (source) =>
        source.provider === "cursor" &&
        (source.status === "ok" || source.status === "partial" || source.refreshing === true),
    );
    const cursorExport =
      cursorEnabled && !hasCursorAccountUsage
        ? yield* loadCursorUsageRecords({
            cacheDir: cursorExportCacheDir,
            nowMs: startedAtMs,
          }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient))
        : ({
            status: "missing",
            message: "Cursor is switched off in settings.",
            userId: null,
          } as const);
    const cursorSessionIds = new Set<string>();
    if (cursorExport.status === "ok") {
      for (const record of cursorExport.records) {
        if (
          aggregator.add(record, toCursorUsageSource(cursorExport).fingerprint.resolvedHomePath) &&
          record.sessionId.length > 0
        ) {
          cursorSessionIds.add(record.sessionId);
        }
      }
    }
    // A switched-off Cursor driver has nothing to report, which is not a
    // coverage gap worth a warning.
    if (cursorEnabled && !hasCursorAccountUsage)
      sources.push(toCursorUsageSource(cursorExport, cursorSessionIds.size));

    const pruned = pruneScanCache(fileCache, retentionCutoffMs);
    if (pruned > 0) cacheDirty = true;

    const aggregated = aggregator.finish();
    const readAt = yield* DateTime.now;
    const finishedAtMs = yield* Clock.currentTimeMillis;

    return projectUsageSummaryForClient(
      {
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: DateTime.formatIso(readAt),
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        buckets: aggregated.buckets,
        sources,
        pricing: pricing(),
        scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
      } satisfies UsageSummary,
      input.clientContractVersion,
    );
  });

  /**
   * In-flight scans by window and usage settings, so concurrent identical requests (the usage
   * page open on two clients at once) share one scan instead of racing over
   * the same corpus twice.
   */
  const inflightScans = new Map<string, Deferred.Deferred<UsageSummary, UsageReadError>>();

  const scanKey = (input: UsageSummaryInput, settings: ServerSettingsValue): string =>
    JSON.stringify([
      input.timeZone,
      input.sinceDay,
      input.untilDay,
      input.resolution ?? "day",
      input.sinceTime ?? null,
      input.untilTime ?? null,
      settings.usagePriceOverrides,
      settings.usageModelAliases,
      settings.cursorKeychainUsageEnabled,
      // A waiting read must never share a scan that answers with `refreshing`.
      input.awaitRefresh === true,
    ]);

  const readSummary = Effect.fn("UsageService.readSummary")(function* (input: UsageSummaryInput) {
    const settings = yield* readSettings;
    const key = scanKey(input, settings);
    const deferred = yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const existing = inflightScans.get(key);
        if (existing !== undefined) return existing;

        // Enrollment and detached-fiber creation must be atomic. Otherwise a
        // canceled first caller can leave a Deferred with no scan to finish it.
        const created = Deferred.makeUnsafe<UsageSummary, UsageReadError>();
        inflightScans.set(key, created);
        // Detached so one departing client cannot tear the scan out from under
        // the fibers awaiting it; a finished scan warms the cache either way.
        // The cache write is registered before the waiters resume, so they
        // can await it, but its fiber starts after they have the summary.
        yield* scanSummary(input, settings).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => inflightScans.delete(key)).pipe(
              Effect.andThen(Exit.isSuccess(exit) ? schedulePersist : Effect.void),
              Effect.andThen(Deferred.done(created, exit)),
            ),
          ),
          Effect.forkDetach,
        );
        return created;
      }),
    );
    // Waiting stays interruptible. The detached scan continues for other
    // callers and still warms the cache if this caller leaves.
    return yield* Deferred.await(deferred);
  });

  // `awaitPersisted` is outside the service interface: tests use it to restart
  // against what a previous instance wrote.
  return { readSummary, refreshRates, awaitPersisted } as const;
});

export const layer = Layer.effect(UsageService, make);
