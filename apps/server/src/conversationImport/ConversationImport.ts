import * as NodeOS from "node:os";

import {
  ClaudeSettings,
  CodexSettings,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  ExternalConversationImportError,
  type ExternalConversationImportInput,
  type ExternalConversationImportResult,
  type ExternalConversationListInput,
  type ExternalConversationListResult,
  type ExternalConversationProvider,
  type ExternalConversationSummary,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { expandHomePath } from "../pathExpansion.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  type ParsedExternalConversation,
  parseClaudeTranscript,
  parseCodexTranscript,
} from "./TranscriptParsers.ts";

const DEFAULT_LIST_LIMIT = 200;

interface NativeConversationSource {
  readonly provider: ExternalConversationProvider;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerLabel: string;
  readonly root: string;
}

interface IndexedConversation {
  readonly externalThreadId: string;
  readonly title: string;
  readonly preview: string;
  readonly cwd?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transcriptPath: string;
}

interface ExternalConversationMarker {
  readonly provider: ExternalConversationProvider;
  readonly providerInstanceId: string;
  readonly externalThreadId: string;
}

export interface ConversationImportShape {
  readonly list: (
    input: ExternalConversationListInput,
  ) => Effect.Effect<ExternalConversationListResult, ExternalConversationImportError>;
  readonly importConversation: (
    input: ExternalConversationImportInput,
  ) => Effect.Effect<ExternalConversationImportResult, ExternalConversationImportError>;
}

export class ConversationImport extends Context.Service<
  ConversationImport,
  ConversationImportShape
>()("t3/conversationImport/ConversationImport") {}

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function field(value: unknown, key: string): unknown {
  return Predicate.isObject(value) ? value[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = field(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const candidate = field(value, key);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function jsonLines(value: string): ReadonlyArray<unknown> {
  return value
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => Option.getOrUndefined(decodeJson(line)))
    .filter((entry): entry is unknown => entry !== undefined);
}

function isoFromEpoch(value: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(value < 10_000_000_000 ? value * 1_000 : value));
}

function titleFromPrompt(prompt: string, fallback: string): string {
  const firstLine = prompt.trim().split(/\r?\n/u)[0]?.trim() ?? "";
  if (firstLine.length === 0) return fallback;
  return firstLine.length <= 100 ? firstLine : `${firstLine.slice(0, 99).trimEnd()}…`;
}

function previewFromPrompt(prompt: string): string {
  const normalized = prompt.trim().replaceAll(/\s+/gu, " ");
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239).trimEnd()}…`;
}

function environmentValue(
  environment: ReadonlyArray<{ readonly name: string; readonly value: string }> | undefined,
  name: string,
): string | undefined {
  const value = environment?.find((entry) => entry.name === name)?.value.trim();
  return value && value.length > 0 ? value : undefined;
}

function absoluteGlobPaths(
  paths: ReadonlyArray<string>,
  root: string,
  path: Path.Path,
): ReadonlyArray<string> {
  return paths.map((entry) => (path.isAbsolute(entry) ? entry : path.join(root, entry)));
}

function transcriptIdFromCodexPath(filePath: string, path: Path.Path): string | undefined {
  const match = path
    .basename(filePath)
    .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu);
  return match?.[1];
}

function markerFromPayload(payload: unknown): ExternalConversationMarker | undefined {
  const marker = field(payload, "externalConversation");
  const provider = stringField(marker, "provider");
  const providerInstanceId = stringField(marker, "providerInstanceId");
  const externalThreadId = stringField(marker, "externalThreadId");
  if (
    (provider !== "claudeAgent" && provider !== "codex") ||
    !providerInstanceId ||
    !externalThreadId
  ) {
    return undefined;
  }
  return { provider, providerInstanceId, externalThreadId };
}

function markerKey(marker: ExternalConversationMarker): string {
  return `${marker.providerInstanceId}\u0000${marker.provider}\u0000${marker.externalThreadId}`;
}

function sourceKey(source: NativeConversationSource, externalThreadId: string): string {
  return markerKey({
    provider: source.provider,
    providerInstanceId: source.providerInstanceId,
    externalThreadId,
  });
}

const makeConversationImport = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settingsService = yield* ServerSettingsService;
  const instanceRegistry = yield* ProviderInstanceRegistry;
  const sessionDirectory = yield* ProviderSessionDirectory;
  const orchestration = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;

  const fail = (
    reason: ExternalConversationImportError["reason"],
    message: string,
    cause?: unknown,
  ) =>
    new ExternalConversationImportError({
      reason,
      message,
      ...(cause === undefined ? {} : { cause }),
    });

  const readSources = Effect.fn("ConversationImport.readSources")(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError((cause) =>
        fail("provider-unavailable", "Could not read provider settings.", cause),
      ),
    );
    const configs = deriveProviderInstanceConfigMap(settings);
    const sources: NativeConversationSource[] = [];
    for (const [rawInstanceId, envelope] of Object.entries(configs)) {
      if (envelope.enabled === false) continue;
      const providerInstanceId = ProviderInstanceId.make(rawInstanceId);
      if (envelope.driver === "claudeAgent") {
        const config = Option.getOrUndefined(decodeClaudeSettings(envelope.config ?? {}));
        if (!config || config.enabled === false) continue;
        const configuredRoot =
          config.homePath.trim() ||
          environmentValue(envelope.environment, "CLAUDE_CONFIG_DIR") ||
          path.join(environmentValue(envelope.environment, "HOME") ?? NodeOS.homedir(), ".claude");
        sources.push({
          provider: "claudeAgent",
          providerInstanceId,
          providerLabel: envelope.displayName ?? "Claude Code",
          root: path.resolve(expandHomePath(configuredRoot)),
        });
      } else if (envelope.driver === "codex") {
        const config = Option.getOrUndefined(decodeCodexSettings(envelope.config ?? {}));
        if (!config || config.enabled === false) continue;
        const configuredRoot =
          config.homePath.trim() ||
          environmentValue(envelope.environment, "CODEX_HOME") ||
          path.join(environmentValue(envelope.environment, "HOME") ?? NodeOS.homedir(), ".codex");
        sources.push({
          provider: "codex",
          providerInstanceId,
          providerLabel: envelope.displayName ?? "Codex",
          root: path.resolve(expandHomePath(configuredRoot)),
        });
      }
    }
    return sources;
  });

  const transcriptPaths = Effect.fn("ConversationImport.transcriptPaths")(function* (
    source: NativeConversationSource,
  ) {
    const patterns =
      source.provider === "claudeAgent"
        ? ["projects/**/*.jsonl"]
        : ["sessions/**/*.jsonl", "archived_sessions/**/*.jsonl"];
    const matches = yield* Effect.forEach(
      patterns,
      (pattern) => fs.glob(pattern, { root: source.root }).pipe(Effect.orElseSucceed(() => [])),
      { concurrency: 2 },
    );
    const paths = absoluteGlobPaths(matches.flat(), source.root, path);
    return new Map(
      paths.flatMap((filePath) => {
        const id =
          source.provider === "claudeAgent"
            ? path.basename(filePath, ".jsonl")
            : transcriptIdFromCodexPath(filePath, path);
        return id ? [[id, filePath] as const] : [];
      }),
    );
  });

  const indexSource = Effect.fn("ConversationImport.indexSource")(function* (
    source: NativeConversationSource,
  ) {
    const files = yield* transcriptPaths(source);
    const indexPath = path.join(source.root, "history.jsonl");
    const history = yield* fs.readFileString(indexPath).pipe(Effect.orElseSucceed(() => ""));
    const indexed = new Map<
      string,
      {
        firstPrompt: string;
        lastPrompt: string;
        createdAt: string;
        updatedAt: string;
        cwd?: string;
      }
    >();
    for (const record of jsonLines(history)) {
      const id =
        source.provider === "claudeAgent"
          ? stringField(record, "sessionId")
          : stringField(record, "session_id");
      const prompt =
        source.provider === "claudeAgent"
          ? stringField(record, "display")
          : stringField(record, "text");
      const epoch =
        source.provider === "claudeAgent"
          ? numberField(record, "timestamp")
          : numberField(record, "ts");
      if (!id || prompt === undefined || epoch === undefined || !files.has(id)) continue;
      const timestamp = isoFromEpoch(epoch);
      const previous = indexed.get(id);
      const cwd =
        source.provider === "claudeAgent"
          ? (stringField(record, "project") ?? previous?.cwd)
          : undefined;
      indexed.set(id, {
        firstPrompt: previous?.firstPrompt ?? prompt,
        lastPrompt: prompt,
        createdAt:
          previous === undefined || timestamp < previous.createdAt ? timestamp : previous.createdAt,
        updatedAt:
          previous === undefined || timestamp > previous.updatedAt ? timestamp : previous.updatedAt,
        ...(cwd === undefined ? {} : { cwd }),
      });
    }
    return Array.from(
      indexed,
      ([externalThreadId, entry]): IndexedConversation => ({
        externalThreadId,
        title: titleFromPrompt(
          entry.firstPrompt,
          source.provider === "claudeAgent" ? "Claude conversation" : "Codex conversation",
        ),
        preview: previewFromPrompt(entry.lastPrompt),
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        transcriptPath: files.get(externalThreadId) as string,
      }),
    );
  });

  const list: ConversationImportShape["list"] = Effect.fn("ConversationImport.list")(
    function* (input) {
      const sources = yield* readSources();
      const [sourceIndexes, bindings] = yield* Effect.all(
        [
          Effect.forEach(sources, (source) => indexSource(source), { concurrency: 4 }),
          sessionDirectory
            .listBindings()
            .pipe(
              Effect.mapError((cause) =>
                fail("import-failed", "Could not inspect imported conversations.", cause),
              ),
            ),
        ] as const,
        { concurrency: 2 },
      );
      const imported = new Map<string, ThreadId>();
      for (const binding of bindings) {
        const marker = markerFromPayload(binding.runtimePayload);
        if (marker) imported.set(markerKey(marker), binding.threadId);
      }
      const conversations = sources.flatMap((source, sourceIndex) =>
        sourceIndexes[sourceIndex]!.map(
          (candidate): ExternalConversationSummary => ({
            externalThreadId: candidate.externalThreadId,
            provider: source.provider,
            providerInstanceId: source.providerInstanceId,
            providerLabel: source.providerLabel,
            title: candidate.title,
            preview: candidate.preview,
            ...(candidate.cwd ? { cwd: candidate.cwd } : {}),
            createdAt: candidate.createdAt,
            updatedAt: candidate.updatedAt,
            ...(imported.get(sourceKey(source, candidate.externalThreadId)) === undefined
              ? {}
              : { importedThreadId: imported.get(sourceKey(source, candidate.externalThreadId)) }),
          }),
        ),
      );
      conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return { conversations: conversations.slice(0, input.limit ?? DEFAULT_LIST_LIMIT) };
    },
  );

  const importConversation: ConversationImportShape["importConversation"] = Effect.fn(
    "ConversationImport.importConversation",
  )(function* (input) {
    const sources = yield* readSources();
    const source = sources.find((entry) => entry.providerInstanceId === input.providerInstanceId);
    if (!source) {
      return yield* fail(
        "provider-unavailable",
        `Provider instance '${input.providerInstanceId}' is not available for imports.`,
      );
    }
    const existingBindings = yield* sessionDirectory
      .listBindings()
      .pipe(
        Effect.mapError((cause) =>
          fail("import-failed", "Could not inspect imported conversations.", cause),
        ),
      );
    const existing = existingBindings.find((binding) => {
      const marker = markerFromPayload(binding.runtimePayload);
      return (
        marker !== undefined && markerKey(marker) === sourceKey(source, input.externalThreadId)
      );
    });
    if (existing) return { threadId: existing.threadId, alreadyImported: true };

    const project = yield* projections
      .getProjectShellById(input.projectId)
      .pipe(
        Effect.mapError((cause) =>
          fail("import-failed", "Could not inspect the target project.", cause),
        ),
      );
    if (Option.isNone(project)) {
      return yield* fail("project-not-found", `Project '${input.projectId}' does not exist.`);
    }

    const instance = yield* instanceRegistry.getInstance(source.providerInstanceId);
    if (!instance || !instance.enabled || instance.driverKind !== source.provider) {
      return yield* fail(
        "provider-unavailable",
        `Provider instance '${source.providerInstanceId}' cannot continue this conversation.`,
      );
    }
    const paths = yield* transcriptPaths(source);
    const transcriptPath = paths.get(input.externalThreadId);
    if (!transcriptPath) {
      return yield* fail(
        "source-not-found",
        `External conversation '${input.externalThreadId}' was not found.`,
      );
    }
    const transcript = yield* fs
      .readFileString(transcriptPath)
      .pipe(
        Effect.mapError((cause) =>
          fail("source-not-found", "Could not read the transcript.", cause),
        ),
      );
    const parsed: ParsedExternalConversation | undefined =
      source.provider === "claudeAgent"
        ? parseClaudeTranscript(transcript, input.externalThreadId)
        : parseCodexTranscript(transcript, input.externalThreadId);
    if (!parsed || parsed.externalThreadId !== input.externalThreadId) {
      return yield* fail(
        "invalid-history",
        `External conversation '${input.externalThreadId}' is not a valid ${source.provider === "claudeAgent" ? "Claude Code" : "Codex"} transcript.`,
      );
    }

    const snapshot = yield* instance.snapshot.getSnapshot.pipe(
      Effect.mapError((cause) =>
        fail("provider-unavailable", "Could not load provider models.", cause),
      ),
    );
    const fallbackModel =
      snapshot.models.find((candidate) => candidate.isDefault)?.slug ??
      snapshot.models[0]?.slug ??
      DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make(source.provider)];
    const model = parsed.model?.trim() || fallbackModel;
    if (!model) {
      return yield* fail(
        "provider-unavailable",
        `Provider instance '${source.providerInstanceId}' does not have an available model.`,
      );
    }
    const modelSelection: ModelSelection = { instanceId: source.providerInstanceId, model };
    const [rawThreadId, rawCommandId, importedAt] = yield* Effect.all(
      [crypto.randomUUIDv4, crypto.randomUUIDv4, DateTime.now.pipe(Effect.map(DateTime.formatIso))],
      { concurrency: 3 },
    ).pipe(
      Effect.mapError((cause) =>
        fail("import-failed", "Could not allocate the imported conversation.", cause),
      ),
    );
    const threadId = ThreadId.make(rawThreadId);
    const commandId = CommandId.make(rawCommandId);
    yield* orchestration
      .dispatch({
        type: "thread.import",
        commandId,
        threadId,
        projectId: input.projectId,
        title: parsed.title,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        messages: parsed.messages,
        activities: parsed.activities,
        session: {
          threadId,
          status: "ready",
          providerName: source.provider,
          providerInstanceId: source.providerInstanceId,
          providerThreadId: parsed.externalThreadId,
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: importedAt,
        },
        sourceCreatedAt: parsed.createdAt,
        sourceUpdatedAt: parsed.updatedAt,
        importedAt,
      })
      .pipe(
        Effect.mapError((cause) =>
          fail("import-failed", "Could not persist the conversation.", cause),
        ),
      );
    yield* sessionDirectory
      .upsert({
        threadId,
        provider: ProviderDriverKind.make(source.provider),
        providerInstanceId: source.providerInstanceId,
        adapterKey: source.provider,
        status: "stopped",
        runtimeMode: "full-access",
        resumeCursor: parsed.resumeCursor,
        runtimePayload: {
          cwd: project.value.workspaceRoot,
          modelSelection,
          externalConversation: {
            provider: source.provider,
            providerInstanceId: source.providerInstanceId,
            externalThreadId: parsed.externalThreadId,
          },
        },
      })
      .pipe(
        Effect.mapError((cause) =>
          fail(
            "import-failed",
            "The conversation imported, but its continuation state could not be saved.",
            cause,
          ),
        ),
      );
    return { threadId, alreadyImported: false };
  });

  return { list, importConversation } satisfies ConversationImportShape;
});

export const layer = Layer.effect(ConversationImport, makeConversationImport);
