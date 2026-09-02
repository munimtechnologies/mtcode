/**
 * UsageService - scans provider transcripts and returns priced usage buckets.
 *
 * Claude, Codex, Grok, and OpenCode are scanned from on-disk session data.
 * Cursor has no local token ledger, so usage comes from the dashboard CSV
 * export when Cursor desktop is signed in on this machine.
 *
 * Transcripts are append-only, so parsed records are memoised per file by
 * `(size, mtime)`. A cold 30-day scan of ~1.4 GB lands around 2-3 seconds; warm
 * scans only reparse files that changed, and a file that merely grew resumes
 * from its cached parse position so only the appended bytes are read.
 *
 * @module UsageService
 */
import * as NodeOS from "node:os";

import {
  ClaudeSettings,
  CodexSettings,
  USAGE_CONTRACT_VERSION,
  type UsageSource,
  type UsageSummary,
  type UsageSummaryInput,
  UsageReadError,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import { expandHomePath } from "../pathExpansion.ts";
import * as ServerSettings from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { hasEnabledCursorInstance } from "./cursorAppData.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { listProviderHomeCandidates, scanHomePath } from "./usageHomes.ts";
import { UsageAggregator } from "./usageAggregation.ts";
import { projectUsageSummaryForClient } from "./usageClientCompat.ts";
import { loadCursorUsageRecords, type CursorExportLoadResult } from "./usageCursorExport.ts";
import { parseRateTable, type RateTable } from "./usagePricing.ts";
import { readOpenCodeUsage, resolveOpenCodeDatabasePaths } from "./usageOpenCode.ts";
import {
  listTranscriptFiles,
  readDirectoryVolumeId,
  readTranscriptRecords,
} from "./usageTranscriptReader.ts";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type ScanCache,
} from "./usageScanCache.ts";
import type { TranscriptProviderKind, UsageRecord } from "./usageTranscripts.ts";

const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Rates move rarely; a day-old table keeps the page working offline. */
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Files are filtered by mtime before opening. The slack covers a session whose
 * last write lands just before local midnight on the window's first day.
 */
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const MAX_HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Longest window the UI offers, plus slack. Older entries are pruned. */
const CACHE_RETENTION_DAYS = 90;

function toCursorUsageSource(result: CursorExportLoadResult, distinctSessions = 0): UsageSource {
  const resolvedHomePath =
    result.userId !== null ? `cursor-export:${result.userId}` : "cursor-export";
  // Cursor export is account-scoped, not host-local. A fixed host/volume keeps
  // the same Cursor login from double-counting across machines.
  const fingerprint = {
    hostId: "cursor-account",
    provider: "cursor" as const,
    resolvedHomePath,
    volumeId: "",
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
const encodeScanCacheFile = Schema.encodeEffect(ScanCacheJson);

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
  }
>()("t3/usage/UsageService") {}

/** Empty summary, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
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
            pricing: {
              status: "unavailable",
              source: LITELLM_RATES_URL,
              fetchedAt: null,
              knownModels: 0,
            },
            scanDurationMs: 0,
          },
          input.clientContractVersion,
        ),
      ),
  }),
);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const hostEnvironment = yield* HostProcessEnvironment;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;

  const fileCache: ScanCache = new Map();
  let cacheDirty = false;

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, "usage-scan-cache.json");
  const cursorExportCacheDir = config.stateDir;
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: UsageSummary["pricing"]["status"] = "unavailable";

  /**
   * Loads the LiteLLM rate table, preferring a fresh copy and falling back to
   * the on-disk snapshot. With neither, every model reports as unpriced rather
   * than the page failing.
   */
  const ensureRates = Effect.fn("UsageService.ensureRates")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < RATES_TTL_MS) return;

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
          if (now - fromDisk.fetchedAtMs < RATES_TTL_MS) return;
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
      Effect.flatMap((serialized) => fileSystem.writeFileString(ratesCachePath, serialized)),
      Effect.catchCause(() => Effect.void),
    );
  });

  /**
   * Claude's config dir is the home itself when overridden, but a default
   * install nests transcripts under `~/.claude/projects`. Probe both.
   */
  const resolveClaudeTranscriptDir = (homePath: string) =>
    Effect.gen(function* () {
      const nested = path.join(homePath, ".claude", "projects");
      const nestedExists = yield* fileSystem
        .exists(nested)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      return nestedExists ? nested : path.join(homePath, "projects");
    });

  /**
   * Resolves the transcript directories for each provider, one per configured
   * provider instance. Instances that share a home (shadow homes symlink
   * `sessions` back into the shared home) collapse to a single directory.
   */
  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* () {
    // A settings failure must surface as an error: swallowing it here would
    // present "zero usage from every provider" as a valid answer.
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(
        (cause) =>
          new UsageReadError({
            reason: "scanFailed",
            // Bounded description; the squashed failure travels as the cause.
            // Squashed, not the Cause tree: a full tree in a Defect field is
            // the unbounded wire payload the bounded detail exists to avoid.
            detail: "Server settings could not be read.",
            cause: Cause.squash(cause),
          }),
      ),
    );

    type JsonlSource = {
      readonly provider: TranscriptProviderKind;
      readonly dir: string;
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
    // that does not resolve (typically: does not exist) keeps its configured
    // path and is reported as missing further down.
    const pushJsonl = (provider: TranscriptProviderKind, dir: string) =>
      Effect.gen(function* () {
        const canonical = yield* fileSystem
          .realPath(dir)
          .pipe(Effect.catchCause(() => Effect.succeed(dir)));
        const key = `${provider}\0${canonical}`;
        if (seen.has(key)) return;
        seen.add(key);
        dirs.push({ provider, dir: canonical, kind: "jsonl" });
      });

    for (const candidate of listProviderHomeCandidates(settings, "claude")) {
      // A blob that fails to decode belongs to an instance the registry
      // already reports as unavailable; the scan skips it.
      const config = yield* decodeClaudeSettings(candidate.config).pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (config === null) continue;
      const claudeHome = yield* resolveClaudeHomePath({
        homePath: scanHomePath(config.homePath, candidate.homeEnvValue, false),
      });
      yield* pushJsonl("claude", yield* resolveClaudeTranscriptDir(claudeHome));
    }

    for (const candidate of listProviderHomeCandidates(settings, "codex")) {
      const config = yield* decodeCodexSettings(candidate.config).pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (config === null) continue;
      const layout = yield* resolveCodexHomeLayout({
        ...config,
        homePath: scanHomePath(
          config.homePath,
          candidate.homeEnvValue,
          config.shadowHomePath.trim().length > 0,
        ),
      });
      yield* pushJsonl("codex", path.join(layout.sharedHomePath, "sessions"));
    }

    const grokHome = path.resolve(
      expandHomePath(readGrokHomeOverride(hostEnvironment) ?? path.join(NodeOS.homedir(), ".grok")),
    );
    yield* pushJsonl("grok", path.join(grokHome, "sessions"));

    const openCodeDataDir = path.join(
      process.env.XDG_DATA_HOME?.trim() || path.join(NodeOS.homedir(), ".local", "share"),
      "opencode",
    );
    const openCodeDatabaseOverride = process.env.OPENCODE_DB?.trim() || undefined;
    const disableOpenCodeChannelDatabase = process.env.OPENCODE_DISABLE_CHANNEL_DB?.trim();
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
   * Loads the persisted scan cache exactly once per process.
   *
   * `Effect.cached` makes concurrent first readers await the same load rather
   * than each seeing a "loaded" flag set before the read finished and cold
   * scanning against an empty cache.
   */
  const ensureScanCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const document = yield* fileSystem.readFileString(scanCachePath).pipe(
        Effect.flatMap((raw) => decodeScanCacheFile(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (document === null) return;
      for (const [path, entry] of decodeScanCache(document)) fileCache.set(path, entry);
    }),
  );

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!cacheDirty) return;
    // Cleared only after the write lands, so a failed persist is retried on
    // the next scan instead of leaving disk permanently stale.
    yield* encodeScanCacheFile(encodeScanCache(fileCache)).pipe(
      Effect.flatMap((serialized) => fileSystem.writeFileString(scanCachePath, serialized)),
      Effect.map(() => {
        cacheDirty = false;
      }),
      // A cache we cannot write is a slower next start, not a failed read.
      Effect.catchCause(() => Effect.void),
    );
  });

  /**
   * Parses one transcript, reusing the cached result when it is unchanged.
   *
   * A file that only grew re-parses from the cached position, so an actively
   * written multi-hundred-megabyte rollout costs its appended bytes per scan
   * rather than a full re-read. The reader verifies the position's guard bytes
   * and silently restarts from byte 0 when they no longer match.
   */
  const readFileRecords = (
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: TranscriptProviderKind,
  ): Effect.Effect<readonly UsageRecord[]> =>
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
        return cached.tailRecords.length === 0
          ? cached.records
          : [...cached.records, ...cached.tailRecords];
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
      if (parsed === null) return [];

      // Stored already de-duplicated within the file, which is 99% of all
      // duplicates. The aggregator still runs the cross-file dedupe pass. One
      // seen set spans the cached base, the new lines, and the tail so a
      // resumed parse dedupes exactly like a full one.
      const base = parsed.resumed && cached !== undefined ? cached.records : [];
      const seen = new Set<string>();
      const records = dedupeWithinFile([...base, ...parsed.records], seen);
      const tailRecords = dedupeWithinFile(parsed.tailRecords, seen);

      fileCache.set(filePath, {
        size,
        mtimeMs,
        provider,
        records,
        tailRecords,
        position: parsed.position,
      });
      cacheDirty = true;
      return tailRecords.length === 0 ? records : [...records, ...tailRecords];
    });

  /** One provider source's walk and parse, before rates are involved. */
  type ScannedSource =
    | {
        readonly kind: "jsonl";
        readonly provider: TranscriptProviderKind;
        readonly dir: string;
        readonly volumeId: string;
        readonly resolvedHomePath: string;
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
        readonly resolvedHomePath: string;
        /** Databases that exist on disk; empty when OpenCode has no ledger here. */
        readonly databasePaths: readonly string[];
      };

  const collectDirs = Effect.fn("UsageService.collectDirs")(function* (windowStartMs: number) {
    // The home resolvers ask for `Path` themselves; satisfy them from the
    // instance we already hold so the scan stays context-free.
    const dirs = yield* resolveTranscriptDirs().pipe(Effect.provideService(Path.Path, path));
    const scanned: ScannedSource[] = [];
    for (const source of dirs) {
      const { dir } = source;
      const volumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
      if (source.kind === "opencodeSqlite") {
        const databasePaths: string[] = [];
        for (const databasePath of source.databasePaths) {
          const databaseExists = yield* fileSystem
            .exists(databasePath)
            .pipe(Effect.catchCause(() => Effect.succeed(false)));
          if (databaseExists) databasePaths.push(databasePath);
        }
        scanned.push({
          kind: "opencodeSqlite",
          provider: source.provider,
          dir,
          volumeId,
          resolvedHomePath: source.resolvedHomePath,
          databasePaths,
        });
        continue;
      }
      const exists = yield* fileSystem
        .exists(dir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      const provider = source.provider;
      if (!exists) {
        scanned.push({
          kind: "jsonl",
          provider,
          dir,
          volumeId,
          resolvedHomePath: dir,
          files: null,
        });
        continue;
      }
      const files = yield* Effect.promise(() => listTranscriptFiles(dir, windowStartMs, provider));
      const parsedFiles: { path: string; records: readonly UsageRecord[] }[] = [];
      for (const file of files) {
        const records = yield* readFileRecords(file.path, file.size, file.mtimeMs, provider);
        parsedFiles.push({ path: file.path, records });
      }
      scanned.push({
        kind: "jsonl",
        provider,
        dir,
        volumeId,
        resolvedHomePath: dir,
        files: parsedFiles,
      });
    }
    return scanned;
  });

  const scanSummary = Effect.fn("UsageService.scanSummary")(function* (input: UsageSummaryInput) {
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

    // Pricing only matters once records are aggregated, so the rate table
    // loads while transcripts stream instead of gating them: a cold rates
    // fetch on a slow network no longer delays the scan by its own timeout.
    const [, scannedDirs] = yield* Effect.all([ensureRates(), collectDirs(windowStartMs)], {
      concurrency: 2,
    });

    const aggregator = new UsageAggregator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      resolution: input.resolution ?? "day",
      ...hourlyWindow,
      rates,
    });

    const sources: UsageSource[] = [];
    const livePaths = new Set<string>();
    const walkedRoots: string[] = [];

    for (const source of scannedDirs) {
      const { provider, dir, volumeId, resolvedHomePath } = source;
      const exists =
        source.kind === "jsonl" ? source.files !== null : source.databasePaths.length > 0;

      if (!exists) {
        sources.push({
          fingerprint: { hostId, provider, resolvedHomePath, volumeId },
          status: "missing",
          scannedFiles: 0,
          skippedFiles: 0,
          malformedRecords: 0,
          distinctSessions: 0,
          message:
            source.kind === "jsonl"
              ? "No transcript directory on this environment."
              : "OpenCode usage database was not found.",
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

      // `exists` already proved the walk completed; this narrows the type.
      if (source.files === null) continue;
      walkedRoots.push(dir);
      let scannedFiles = 0;
      let skippedFiles = 0;
      // Distinct per directory. Buckets carry per-cell session counts, but a
      // session spans days and models, so clients total this figure instead.
      const sessionIds = new Set<string>();

      for (const file of source.files) {
        livePaths.add(file.path);
        if (file.records.length === 0) {
          skippedFiles += 1;
          continue;
        }
        scannedFiles += 1;
        for (const record of file.records) {
          // Only sessions that contributed in-window count: the mtime slack
          // admits boundary files whose records fall outside the range.
          if (aggregator.add(record) && record.sessionId.length > 0) {
            sessionIds.add(record.sessionId);
          }
        }
      }

      sources.push({
        fingerprint: { hostId, provider, resolvedHomePath, volumeId },
        status: "ok",
        scannedFiles,
        skippedFiles,
        malformedRecords: 0,
        distinctSessions: sessionIds.size,
        message: null,
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
    const cursorExport = cursorEnabled
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
        if (aggregator.add(record) && record.sessionId.length > 0) {
          cursorSessionIds.add(record.sessionId);
        }
      }
    }
    sources.push(toCursorUsageSource(cursorExport, cursorSessionIds.size));

    // Keep at least 90 days warm for short views, but never drop entries that
    // fall inside the window we just walked (e.g. an "All" scan from 2020).
    const retentionCutoffMs = Math.min(
      windowStartMs,
      startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const pruned = pruneScanCache(fileCache, {
      livePaths,
      walkedRoots,
      windowStartMs,
      retentionCutoffMs,
    });
    if (pruned > 0) cacheDirty = true;
    yield* persistScanCache();

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
        pricing: {
          status: ratesStatus,
          source: LITELLM_RATES_URL,
          fetchedAt:
            ratesFetchedAtMs === null
              ? null
              : DateTime.formatIso(DateTime.makeUnsafe(ratesFetchedAtMs)),
          knownModels: rates.size,
        },
        scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
      } satisfies UsageSummary,
      input.clientContractVersion,
    );
  });

  /**
   * In-flight scans by window, so concurrent identical requests (the usage
   * page open on two clients at once) share one scan instead of racing over
   * the same corpus twice.
   */
  const inflightScans = new Map<string, Deferred.Deferred<UsageSummary, UsageReadError>>();

  const scanKey = (input: UsageSummaryInput): string =>
    JSON.stringify([
      input.timeZone,
      input.sinceDay,
      input.untilDay,
      input.resolution ?? "day",
      input.sinceTime ?? null,
      input.untilTime ?? null,
    ]);

  const readSummary = Effect.fn("UsageService.readSummary")(function* (input: UsageSummaryInput) {
    const key = scanKey(input);
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
        yield* scanSummary(input).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => inflightScans.delete(key)).pipe(
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

  return { readSummary } as const;
});

export const layer = Layer.effect(UsageService, make);
