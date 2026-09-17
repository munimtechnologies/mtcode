import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as CodexClient from "effect-codex-app-server/client";

import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  PluginMarketplaceNotFoundError,
  PluginMarketplaceOperationError,
  PluginMarketplaceUnavailableError,
  type PluginMarketplaceApp,
  type PluginMarketplaceCatalog,
  type PluginMarketplaceDetail,
  type PluginMarketplaceExtension,
  type PluginMarketplaceExtensionKind,
  type PluginMarketplaceInstallTarget,
  type PluginMarketplaceLogo,
  type PluginMarketplaceMcpAuthConnection,
  type PluginMarketplaceMcpAuthMutationResult,
  type PluginMarketplaceMcpAuthStartResult,
  type PluginMarketplaceMcpAuthState,
  type PluginMarketplaceMcpServer,
  type PluginMarketplaceMutationResult,
  type PluginMarketplaceNotice,
  type PluginMarketplacePlugin,
  type PluginMarketplaceSetupAction,
  type PluginMarketplaceSetupResult,
  type PluginMarketplaceSkill,
  type PluginMarketplaceSourceType,
  type PluginMarketplaceHarnessId,
} from "@t3tools/contracts";
import {
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import * as ProcessRunner from "../processRunner.ts";
import { ServerConfig } from "../config.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { makeClaudeEnvironment } from "../provider/Drivers/ClaudeHome.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import * as ServerSettings from "../serverSettings.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import * as McpOAuthRuntime from "./McpOAuthRuntime.ts";
import { resolveAppDisplayName } from "../appDisplayName.ts";
import {
  CHATGPT_PUBLIC_MARKETPLACE_NAME,
  CHATGPT_PUBLIC_PLUGIN_SEARCH_MAX_PAGES,
  CHATGPT_PUBLIC_PLUGIN_SEARCH_MIN_QUERY_LENGTH,
  type ChatGptPublicPlugin,
  chatGptPublicPluginMarketplaceUrl,
  chatGptPublicPluginNameFromPublicId,
  chatGptPublicPluginSearchUrl,
  chatGptPublicPluginSourceId,
  chatGptPublicPluginsFromListResponse,
  codexChatGptAuthFromTokens,
  decodeChatGptPublicPluginListResponse,
  decodeCodexChatGptAccessToken,
} from "./ChatGptPublicPlugins.ts";

const CATALOG_CACHE_TTL_MS = 30_000;
// A cold Codex marketplace sync can take well over 30 seconds. The CLI gets a generous ceiling,
// while each harness only holds the catalog response for HARNESS_SYNC_BUDGET before the catalog
// is returned with a "still syncing" notice and the read continues in the background.
const CODEX_PLUGIN_LIST_TIMEOUT = "120 seconds";
const HARNESS_SYNC_BUDGET = "20 seconds";
const CODEX_CURATED_MARKETPLACE = "openai-curated";
const CODEX_CURATED_REMOTE_MARKETPLACE = "openai-curated-remote";
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_CATALOG_LOGO_BYTES = 48 * 1024;
const MAX_REMOTE_DESCRIPTION_FILES = 32;
const MAX_REMOTE_TREE_ENTRIES = 20_000;
const decodeCodexSettingsOption = Schema.decodeUnknownOption(CodexSettings);
const decodeClaudeSettingsOption = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCursorSettingsOption = Schema.decodeUnknownOption(CursorSettings);

// Codex emits `null` for absent fields, so app-server payloads must accept both null and
// missing keys. Excess keys are ignored, which keeps newer Codex builds from breaking decoding.
const NullableString = Schema.optionalKey(Schema.NullOr(Schema.String));
const NullableBoolean = Schema.optionalKey(Schema.NullOr(Schema.Boolean));
const NullableStrings = Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String)));

// `codex plugin list --available --json`. Remote catalog entries carry `{ source: "remote", id }`
// with no path; older builds only emit local/git sources with a path.
const CodexPluginSource = Schema.Struct({
  source: Schema.String,
  path: NullableString,
  id: NullableString,
});

const CodexPluginMarketplaceSource = Schema.Struct({
  sourceType: Schema.String,
  source: Schema.String,
});

const CodexPluginRecord = Schema.Struct({
  pluginId: Schema.String,
  name: Schema.String,
  marketplaceName: Schema.String,
  version: NullableString,
  installed: NullableBoolean,
  enabled: NullableBoolean,
  source: Schema.optionalKey(Schema.NullOr(CodexPluginSource)),
  marketplaceSource: Schema.optionalKey(Schema.NullOr(CodexPluginMarketplaceSource)),
  installPolicy: NullableString,
  authPolicy: NullableString,
});
type CodexPluginRecord = typeof CodexPluginRecord.Type;
const decodeCodexPluginRecordOption = Schema.decodeUnknownOption(CodexPluginRecord);

// Codex app-server `plugin/list`, `plugin/installed`, and `plugin/read` payloads, decoded
// leniently one marketplace and one plugin at a time so a single unexpected entry cannot sink the
// whole Codex catalog.
const CodexRuntimePluginInterface = Schema.Struct({
  displayName: NullableString,
  shortDescription: NullableString,
  longDescription: NullableString,
  developerName: NullableString,
  category: NullableString,
  capabilities: NullableStrings,
  websiteUrl: NullableString,
  brandColor: NullableString,
  composerIcon: NullableString,
  logo: NullableString,
  composerIconUrl: NullableString,
  logoUrl: NullableString,
  defaultPrompt: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  ),
});
type CodexRuntimePluginInterface = typeof CodexRuntimePluginInterface.Type;
const CodexRuntimePluginSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  remotePluginId: NullableString,
  version: NullableString,
  localVersion: NullableString,
  source: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ type: NullableString, path: NullableString })),
  ),
  installed: NullableBoolean,
  enabled: NullableBoolean,
  installPolicy: NullableString,
  authPolicy: NullableString,
  availability: NullableString,
  interface: Schema.optionalKey(Schema.NullOr(CodexRuntimePluginInterface)),
});
const decodeCodexRuntimePluginSummaryOption = Schema.decodeUnknownOption(CodexRuntimePluginSummary);
const CodexRuntimeMarketplaceEntry = Schema.Struct({
  name: Schema.String,
  path: NullableString,
  interface: Schema.optionalKey(Schema.NullOr(Schema.Struct({ displayName: NullableString }))),
  plugins: Schema.Array(Schema.Unknown),
});
const decodeCodexRuntimeMarketplaceEntryOption = Schema.decodeUnknownOption(
  CodexRuntimeMarketplaceEntry,
);
const CodexRuntimeListResponse = Schema.Struct({
  marketplaces: Schema.Array(Schema.Unknown),
  featuredPluginIds: NullableStrings,
  marketplaceLoadErrors: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(Schema.Struct({ marketplacePath: NullableString, message: NullableString })),
    ),
  ),
});
const decodeCodexRuntimeListResponseOption = Schema.decodeUnknownOption(CodexRuntimeListResponse);
const CodexRuntimeReadResponse = Schema.Struct({
  plugin: Schema.Struct({
    description: NullableString,
    skills: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
    mcpServers: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
    apps: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
    hooks: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  }),
});
const decodeCodexRuntimeReadResponseOption = Schema.decodeUnknownOption(CodexRuntimeReadResponse);
const CodexRuntimeSkillSummary = Schema.Struct({
  name: Schema.String,
  description: NullableString,
});
const decodeCodexRuntimeSkillSummaryOption = Schema.decodeUnknownOption(CodexRuntimeSkillSummary);
const CodexRuntimeAppSummary = Schema.Struct({
  id: Schema.String,
  name: NullableString,
  description: NullableString,
  installUrl: NullableString,
});
const decodeCodexRuntimeAppSummaryOption = Schema.decodeUnknownOption(CodexRuntimeAppSummary);

const ClaudeInstalledPlugin = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  enabled: Schema.Boolean,
  installPath: Schema.String,
});
type ClaudeInstalledPlugin = typeof ClaudeInstalledPlugin.Type;

const ClaudeAvailablePlugin = Schema.Struct({
  pluginId: Schema.String,
  name: Schema.String,
  description: Schema.String,
  marketplaceName: Schema.String,
  source: Schema.Unknown,
  installCount: Schema.optional(Schema.Number),
});
type ClaudeAvailablePlugin = typeof ClaudeAvailablePlugin.Type;

const ClaudePluginListOutput = Schema.Struct({
  installed: Schema.Array(ClaudeInstalledPlugin),
  available: Schema.Array(ClaudeAvailablePlugin),
});
const decodeClaudePluginListJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ClaudePluginListOutput),
);
const ClaudeMarketplaceRecord = Schema.Struct({
  name: Schema.String,
  installLocation: Schema.String,
});
const decodeClaudeMarketplaceListJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(ClaudeMarketplaceRecord)),
);

const MarketplaceManifestPlugin = Schema.Struct({
  name: Schema.String,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  author: Schema.optional(
    Schema.Union([Schema.String, Schema.Struct({ name: Schema.optional(Schema.String) })]),
  ),
  category: Schema.optional(Schema.String),
  homepage: Schema.optional(Schema.String),
  source: Schema.Unknown,
});
type MarketplaceManifestPlugin = typeof MarketplaceManifestPlugin.Type;
const MarketplaceManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  interface: Schema.optional(Schema.Struct({ displayName: Schema.optional(Schema.String) })),
  plugins: Schema.Array(MarketplaceManifestPlugin),
});

const CursorMarketplaceSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  sourceUrl: Schema.optional(Schema.String),
});
const CursorMarketplaceExtension = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  sourceUrl: Schema.optional(Schema.String),
});
const CursorMarketplaceMcpServer = Schema.Struct({
  name: Schema.String,
  sourceUrl: Schema.optional(Schema.String),
});
const CursorMarketplacePlugin = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  repositoryUrl: Schema.optional(Schema.String),
  logoUrl: Schema.optional(Schema.String),
  publisher: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      displayName: Schema.optional(Schema.String),
      logoUrl: Schema.optional(Schema.String),
      websiteUrl: Schema.optional(Schema.String),
    }),
  ),
  marketplace: Schema.optional(
    Schema.Struct({ name: Schema.String, displayName: Schema.optional(Schema.String) }),
  ),
  gitRef: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(CursorMarketplaceSkill)),
  mcpServers: Schema.optional(Schema.Array(CursorMarketplaceMcpServer)),
  commands: Schema.optional(Schema.Array(CursorMarketplaceExtension)),
  rules: Schema.optional(Schema.Array(CursorMarketplaceExtension)),
  subagents: Schema.optional(Schema.Array(CursorMarketplaceExtension)),
  hooks: Schema.optional(Schema.Array(CursorMarketplaceExtension)),
  curatedCategoryKeys: Schema.optional(Schema.Array(Schema.String)),
});
type CursorMarketplacePlugin = typeof CursorMarketplacePlugin.Type;
const decodeCursorMarketplacePlugins = Schema.decodeUnknownEffect(
  Schema.Array(CursorMarketplacePlugin),
);

const CodexPluginListOutput = Schema.Struct({
  installed: Schema.Array(Schema.Unknown),
  available: Schema.Array(Schema.Unknown),
});
const decodeCodexPluginListJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CodexPluginListOutput),
);
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const MarketplacePluginSourceObject = Schema.Struct({
  source: Schema.String,
  url: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  sha: Schema.optional(Schema.String),
});
const decodeMarketplacePluginSourceObject = Schema.decodeUnknownOption(
  MarketplacePluginSourceObject,
);

const GitHubTree = Schema.Struct({
  truncated: Schema.optional(Schema.Boolean),
  tree: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      type: Schema.String,
    }),
  ),
});
const decodeGitHubTreeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(GitHubTree));
const GitHubCommit = Schema.Struct({ sha: Schema.String });
const decodeGitHubCommitJson = Schema.decodeUnknownEffect(Schema.fromJsonString(GitHubCommit));

const PluginManifestAuthor = Schema.Union([
  Schema.String,
  Schema.Struct({ name: Schema.optional(Schema.String) }),
]);

const PluginManifestInterface = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  shortDescription: Schema.optional(Schema.String),
  longDescription: Schema.optional(Schema.String),
  developerName: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  websiteURL: Schema.optional(Schema.String),
  defaultPrompt: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  brandColor: Schema.optional(Schema.String),
  composerIcon: Schema.optional(Schema.String),
  logo: Schema.optional(Schema.String),
});

const PluginManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  author: Schema.optional(PluginManifestAuthor),
  homepage: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  logo: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Unknown),
  mcpServers: Schema.optional(Schema.Unknown),
  apps: Schema.optional(Schema.Unknown),
  hooks: Schema.optional(Schema.Unknown),
  interface: Schema.optional(PluginManifestInterface),
});
type PluginManifest = typeof PluginManifest.Type;
const decodePluginManifestJson = Schema.decodeUnknownEffect(Schema.fromJsonString(PluginManifest));

interface RemotePluginPreviewSource {
  readonly owner: string;
  readonly repository: string;
  readonly revision: string;
  readonly subdirectory: string;
  readonly repositoryUrl: string;
}

interface PluginSourceRecord {
  readonly pluginId: string;
  readonly sourcePluginId: string;
  readonly harness: Extract<PluginMarketplaceHarnessId, "codex" | "claude" | "cursor">;
  readonly name: string;
  readonly marketplaceName: string;
  readonly marketplaceLabel: string;
  readonly version: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly pluginRoot: string | null;
  readonly manifestDirectory: ".codex-plugin" | ".claude-plugin" | ".cursor-plugin";
  readonly marketplaceSourceType: PluginMarketplaceSourceType;
  readonly installPolicy: string;
  readonly authPolicy: string;
  readonly fallbackDescription: string;
  readonly fallbackDisplayName: string;
  readonly fallbackDeveloper: string;
  readonly fallbackCategory: string;
  readonly fallbackHomepage: string | null;
  readonly fallbackRepository: string | null;
  readonly marketplaceUrl: string | null;
  readonly externalLogoUrl: string | null;
  readonly directSkills: ReadonlyArray<PluginMarketplaceSkill>;
  readonly directMcpServers: ReadonlyArray<PluginMarketplaceMcpServer>;
  readonly directApps: ReadonlyArray<PluginMarketplaceApp>;
  readonly directExtensions: ReadonlyArray<PluginMarketplaceExtension>;
  readonly remotePreviewSource: RemotePluginPreviewSource | null;
  readonly hasHooks: boolean;
  /** Marketplace-provided metadata used when no plugin manifest exists on disk. */
  readonly fallbackManifest?: PluginManifest;
  /** Featured by the marketplace itself (Codex `featuredPluginIds`). */
  readonly featured?: boolean;
  /** Absolute artwork path reported by the Codex app-server for local packages. */
  readonly runtimeLogoPath?: string | null;
  /** Present when Codex can install or remove this plugin through its remote catalog. */
  readonly codexRemote?: CodexRemotePluginRef;
  /** A local marketplace snapshot copy is installed alongside the remote catalog entry. */
  readonly codexLegacyInstalled?: boolean;
  /** Runtime id of the installed remote catalog copy, or null when only local copies exist. */
  readonly codexRuntimeInstalledId?: string | null;
}

interface CodexRemotePluginRef {
  readonly pluginName: string;
  readonly marketplaceName: string;
  readonly remotePluginId: string | null;
}

interface CodexRuntimePlugin {
  readonly id: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly remotePluginId: string | null;
  readonly installed: boolean;
  readonly enabled: boolean;
}

export interface CodexRuntimeCatalogPlugin extends CodexRuntimePlugin {
  readonly marketplaceDisplayName: string | null;
  readonly marketplacePath: string | null;
  readonly version: string | null;
  readonly sourceType: string | null;
  readonly sourcePath: string | null;
  readonly installPolicy: string | null;
  readonly authPolicy: string | null;
  readonly availability: string | null;
  readonly interface: CodexRuntimePluginInterface | null;
}

export interface CodexRuntimeCatalog {
  readonly plugins: ReadonlyArray<CodexRuntimeCatalogPlugin>;
  readonly featuredPluginIds: ReadonlyArray<string>;
  readonly loadErrors: ReadonlyArray<string>;
}

export interface CodexRuntimePluginDetail {
  readonly description: string | null;
  readonly skills: ReadonlyArray<{ readonly name: string; readonly description: string | null }>;
  readonly mcpServerNames: ReadonlyArray<string>;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string | null;
    readonly description: string | null;
    readonly installUrl: string | null;
  }>;
  readonly hookCount: number;
}

const CodexPluginRuntimeErrorFields = {
  operation: Schema.Literals(["installed", "list", "read", "install", "remove"]),
  pluginRef: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
};

class CodexPluginProviderUnavailableError extends Schema.TaggedError<CodexPluginProviderUnavailableError>()(
  "CodexPluginProviderUnavailableError",
  CodexPluginRuntimeErrorFields,
) {
  override get message(): string {
    return "The configured Codex provider is unavailable.";
  }
}

class CodexPluginNotFoundError extends Schema.TaggedError<CodexPluginNotFoundError>()(
  "CodexPluginNotFoundError",
  CodexPluginRuntimeErrorFields,
) {
  override get message(): string {
    const target = this.pluginRef === undefined ? "" : ` for '${this.pluginRef}'`;
    return `Codex could not find the plugin${target}.`;
  }
}

class CodexPluginStillInstalledError extends Schema.TaggedError<CodexPluginStillInstalledError>()(
  "CodexPluginStillInstalledError",
  CodexPluginRuntimeErrorFields,
) {
  override get message(): string {
    const target = this.pluginRef === undefined ? "" : ` for '${this.pluginRef}'`;
    return `Codex still reports the plugin${target} as installed.`;
  }
}

class CodexPluginOperationFailedError extends Schema.TaggedError<CodexPluginOperationFailedError>()(
  "CodexPluginOperationFailedError",
  CodexPluginRuntimeErrorFields,
) {
  override get message(): string {
    const target = this.pluginRef === undefined ? "" : ` for '${this.pluginRef}'`;
    return `Codex plugin runtime operation '${this.operation}' failed${target}.`;
  }
}
const CodexPluginRuntimeError = Schema.Union([
  CodexPluginProviderUnavailableError,
  CodexPluginNotFoundError,
  CodexPluginStillInstalledError,
  CodexPluginOperationFailedError,
]);
type CodexPluginRuntimeError = typeof CodexPluginRuntimeError.Type;
const isCodexPluginRuntimeError = Schema.is(CodexPluginRuntimeError);

export class CodexPluginRuntime extends Context.Service<
  CodexPluginRuntime,
  {
    readonly installed: () => Effect.Effect<
      ReadonlyArray<CodexRuntimePlugin>,
      CodexPluginRuntimeError
    >;
    /**
     * Full catalog from the app-server (`plugin/list` + `plugin/installed`). This is how the Codex
     * app itself lists plugins and is the preferred source; the CLI JSON is the fallback.
     */
    readonly list?: () => Effect.Effect<CodexRuntimeCatalog, CodexPluginRuntimeError>;
    /** Inventory of a plugin that has no local package, via `plugin/read`. */
    readonly read?: (
      target: CodexRemotePluginRef,
    ) => Effect.Effect<CodexRuntimePluginDetail, CodexPluginRuntimeError>;
    readonly install: (
      pluginName: string,
      remote?: { readonly remotePluginId: string; readonly marketplaceName: string },
    ) => Effect.Effect<void, CodexPluginRuntimeError>;
    readonly remove: (pluginId: string) => Effect.Effect<void, CodexPluginRuntimeError>;
  }
>()("t3/plugins/CodexPluginMarketplace/CodexPluginRuntime") {}

interface PluginProviderCommand {
  readonly command: string;
  readonly env: NodeJS.ProcessEnv;
}

class PluginProviderCommands extends Context.Service<
  PluginProviderCommands,
  {
    readonly resolve: (
      harness: McpOAuthRuntime.McpOAuthHarness,
    ) => Effect.Effect<PluginProviderCommand | undefined>;
  }
>()("t3/plugins/CodexPluginMarketplace/PluginProviderCommands") {}

const SkillFrontmatter = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});
const decodeSkillFrontmatter = Schema.decodeUnknownOption(fromYaml(SkillFrontmatter));

const McpServerConfig = Schema.Struct({
  type: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  env_vars: Schema.optional(Schema.Array(Schema.String)),
  oauth_resource: Schema.optional(Schema.String),
  bearer_token_env_var: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  tool_timeout_sec: Schema.optional(Schema.Number),
  env: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const McpServerMap = Schema.Record(Schema.String, McpServerConfig);
const WrappedMcpServerMap = Schema.Struct({
  mcpServers: Schema.optional(McpServerMap),
  mcp_servers: Schema.optional(McpServerMap),
});
const decodeMcpServerMap = Schema.decodeUnknownOption(McpServerMap);
const decodeWrappedMcpServerMap = Schema.decodeUnknownOption(WrappedMcpServerMap);

const AppConfig = Schema.Struct({ id: Schema.optional(Schema.String) });
const AppMap = Schema.Record(Schema.String, AppConfig);
const WrappedAppMap = Schema.Struct({ apps: AppMap });

interface LoadedPlugin {
  readonly record: PluginSourceRecord;
  readonly detail: PluginMarketplaceDetail;
  readonly logoPath: string | null;
  /** The Codex app-server inventory for a remote-only plugin has been merged into `detail`. */
  readonly codexRemoteDetailLoaded?: boolean;
}

interface CatalogSnapshot {
  readonly expiresAt: number;
  readonly catalog: PluginMarketplaceCatalog;
  readonly plugins: ReadonlyMap<string, LoadedPlugin>;
  readonly notices: ReadonlyArray<PluginMarketplaceNotice>;
}

type HarnessSourceKey = Extract<PluginMarketplaceHarnessId, "codex" | "claude" | "cursor">;

type HarnessSourceResult = Result.Result<
  ReadonlyArray<PluginSourceRecord>,
  PluginMarketplaceUnavailableError
>;

interface McpAuthCandidate {
  readonly target: PluginMarketplaceInstallTarget;
  readonly packageName: string;
  readonly server: PluginMarketplaceMcpServer;
}

export class CodexPluginMarketplace extends Context.Service<
  CodexPluginMarketplace,
  {
    readonly catalog: (
      query?: string,
    ) => Effect.Effect<PluginMarketplaceCatalog, PluginMarketplaceUnavailableError>;
    readonly detail: (
      pluginId: string,
    ) => Effect.Effect<
      PluginMarketplaceDetail,
      PluginMarketplaceUnavailableError | PluginMarketplaceNotFoundError
    >;
    readonly logo: (
      pluginId: string,
    ) => Effect.Effect<
      PluginMarketplaceLogo,
      PluginMarketplaceUnavailableError | PluginMarketplaceNotFoundError
    >;
    readonly mcpAuth: (
      pluginId: string,
    ) => Effect.Effect<
      PluginMarketplaceMcpAuthState,
      PluginMarketplaceUnavailableError | PluginMarketplaceNotFoundError
    >;
    readonly startMcpAuth: (
      pluginId: string,
      harness: PluginMarketplaceHarnessId,
      serverId: string,
    ) => Effect.Effect<
      PluginMarketplaceMcpAuthStartResult,
      | PluginMarketplaceUnavailableError
      | PluginMarketplaceNotFoundError
      | PluginMarketplaceOperationError
    >;
    readonly completeMcpAuth: (
      pluginId: string,
      harness: PluginMarketplaceHarnessId,
      serverId: string,
      callbackUrl: string,
    ) => Effect.Effect<
      PluginMarketplaceMcpAuthMutationResult,
      | PluginMarketplaceUnavailableError
      | PluginMarketplaceNotFoundError
      | PluginMarketplaceOperationError
    >;
    readonly disconnectMcpAuth: (
      pluginId: string,
      harness: PluginMarketplaceHarnessId,
      serverId: string,
    ) => Effect.Effect<
      PluginMarketplaceMcpAuthMutationResult,
      | PluginMarketplaceUnavailableError
      | PluginMarketplaceNotFoundError
      | PluginMarketplaceOperationError
    >;
    readonly install: (
      pluginId: string,
    ) => Effect.Effect<
      PluginMarketplaceMutationResult,
      | PluginMarketplaceUnavailableError
      | PluginMarketplaceNotFoundError
      | PluginMarketplaceOperationError
    >;
    readonly setup: (
      pluginId: string,
      action: PluginMarketplaceSetupAction,
    ) => Effect.Effect<
      PluginMarketplaceSetupResult,
      | PluginMarketplaceUnavailableError
      | PluginMarketplaceNotFoundError
      | PluginMarketplaceOperationError
    >;
    readonly remove: (
      pluginId: string,
    ) => Effect.Effect<
      PluginMarketplaceMutationResult,
      | PluginMarketplaceUnavailableError
      | PluginMarketplaceNotFoundError
      | PluginMarketplaceOperationError
    >;
  }
>()("t3/plugins/CodexPluginMarketplace") {}

function cleanText(value: string | undefined, fallback: string): string {
  const cleaned = value?.trim();
  return cleaned ? cleaned : fallback;
}

function displayNameFromId(id: string): string {
  return id
    .split(/[-_]/gu)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizedMcpEndpoint(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return `${url.protocol}//${url.host}${pathname}${url.search}`;
  } catch {
    return value.replace(/\/+$/u, "").toLocaleLowerCase();
  }
}

function resolveNativeMcpStatus(
  harness: McpOAuthRuntime.McpOAuthHarness,
  packageName: string,
  server: PluginMarketplaceMcpServer,
  statuses: ReadonlyArray<McpOAuthRuntime.McpOAuthServerStatus>,
): McpOAuthRuntime.McpOAuthServerStatus | null {
  const serverId = server.id.toLocaleLowerCase();
  const names = new Set([
    serverId,
    server.name.toLocaleLowerCase(),
    ...(harness === "claude" ? [`plugin:${packageName.toLocaleLowerCase()}:${serverId}`] : []),
  ]);
  const endpoint = normalizedMcpEndpoint(server.url);
  const packageNameLower = packageName.toLocaleLowerCase();
  return (
    statuses.find((status) => names.has(status.name.toLocaleLowerCase())) ??
    statuses.find(
      (status) => endpoint !== null && normalizedMcpEndpoint(status.url) === endpoint,
    ) ??
    statuses.find((status) => {
      const statusName = status.name.toLocaleLowerCase();
      return (
        harness === "claude" &&
        statusName.includes(`:${packageNameLower}:`) &&
        statusName.endsWith(`:${serverId}`)
      );
    }) ??
    null
  );
}

function manifestDeveloper(manifest: PluginManifest, fallback = "Unknown"): string {
  const interfaceDeveloper = manifest.interface?.developerName?.trim();
  if (interfaceDeveloper) return interfaceDeveloper;
  if (typeof manifest.author === "string") return cleanText(manifest.author, fallback);
  return cleanText(manifest.author?.name, fallback);
}

function extractFrontmatter(markdown: string): string | null {
  if (!markdown.startsWith("---")) return null;
  const closing = markdown.indexOf("\n---", 3);
  return closing === -1 ? null : markdown.slice(3, closing).trim();
}

function sanitizeRemoteUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/u, 1)[0]?.replace(/^([^:/?#]+:\/\/)[^/]*@/u, "$1") ?? null;
  }
}

function publicOperationDetail(code: number | null): string {
  return code === null
    ? "The provider did not report an exit status."
    : `The provider exited with status ${code}.`;
}

function marketplaceSourceType(value: string | null | undefined): PluginMarketplaceSourceType {
  return value === "local" || value === "git" || value === "remote" ? value : "unknown";
}

// Friendly names for the marketplaces Codex and Claude ship with. Codex reports
// "OpenAI Curated Remote" for its official catalog, which is not a name users recognise.
const KNOWN_MARKETPLACE_LABELS: Readonly<Record<string, string>> = {
  [CODEX_CURATED_MARKETPLACE]: "Codex official",
  [CODEX_CURATED_REMOTE_MARKETPLACE]: "Codex official",
  "openai-bundled": "Bundled",
  "openai-primary-runtime": "Codex runtime",
  "claude-plugins-official": "Claude official",
};

function marketplaceLabel(name: string, displayName?: string | null): string {
  return (
    KNOWN_MARKETPLACE_LABELS[name] ?? cleanText(displayName ?? undefined, displayNameFromId(name))
  );
}

/**
 * One Codex plugin entry regardless of whether it came from the app-server catalog, the CLI
 * JSON, or the app-server installed inventory. Entries are merged into source records by
 * `mergeCodexEntries`.
 */
interface CodexCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly marketplaceLabel: string;
  readonly version: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly pluginRoot: string | null;
  readonly marketplaceSourceType: PluginMarketplaceSourceType;
  readonly remotePluginId: string | null;
  readonly installPolicy: string;
  readonly authPolicy: string;
  readonly interface: CodexRuntimePluginInterface | null;
  readonly manifestCategory: string | null;
  readonly featured: boolean;
}

function codexEntryFromRuntimePlugin(
  plugin: CodexRuntimeCatalogPlugin,
  featuredIds: ReadonlySet<string>,
  isAbsolute: (value: string) => boolean,
): CodexCatalogEntry {
  const sourcePath = plugin.sourcePath?.trim() || null;
  const availability = plugin.availability?.trim();
  return {
    id: plugin.id,
    name: plugin.name,
    marketplaceName: plugin.marketplaceName,
    marketplaceLabel: marketplaceLabel(plugin.marketplaceName, plugin.marketplaceDisplayName),
    version: cleanText(plugin.version ?? undefined, "unknown"),
    installed: plugin.installed,
    enabled: plugin.enabled,
    pluginRoot: sourcePath && isAbsolute(sourcePath) ? sourcePath : null,
    marketplaceSourceType: marketplaceSourceType(plugin.sourceType),
    remotePluginId: plugin.remotePluginId?.trim() || null,
    installPolicy:
      availability && availability !== "AVAILABLE"
        ? availability
        : cleanText(plugin.installPolicy ?? undefined, "AVAILABLE"),
    authPolicy: cleanText(plugin.authPolicy ?? undefined, "ON_INSTALL"),
    interface: plugin.interface,
    manifestCategory: null,
    featured: featuredIds.has(plugin.id),
  };
}

function codexEntryFromCliRecord(
  record: CodexPluginRecord,
  marketplace: { readonly label: string; readonly category: string | null } | undefined,
): CodexCatalogEntry {
  const source = record.source ?? null;
  const sourceKind = source?.source ?? null;
  const pluginRoot = source?.path?.trim() || null;
  return {
    id: record.pluginId,
    name: record.name,
    marketplaceName: record.marketplaceName,
    marketplaceLabel: marketplace?.label ?? marketplaceLabel(record.marketplaceName),
    version: cleanText(record.version ?? undefined, "unknown"),
    installed: record.installed === true,
    enabled: record.enabled === true,
    pluginRoot,
    marketplaceSourceType: marketplaceSourceType(
      record.marketplaceSource?.sourceType ?? sourceKind,
    ),
    remotePluginId: sourceKind === "remote" ? (source?.id?.trim() ?? null) || null : null,
    installPolicy: cleanText(record.installPolicy ?? undefined, "AVAILABLE"),
    authPolicy: cleanText(record.authPolicy ?? undefined, "ON_INSTALL"),
    interface: null,
    manifestCategory: marketplace?.category ?? null,
    featured: false,
  };
}

function codexEntryFromInstalledRuntimePlugin(plugin: CodexRuntimePlugin): CodexCatalogEntry {
  return {
    id: plugin.id,
    name: plugin.name,
    marketplaceName: plugin.marketplaceName,
    marketplaceLabel: marketplaceLabel(plugin.marketplaceName),
    version: "unknown",
    installed: plugin.installed,
    enabled: plugin.enabled,
    pluginRoot: null,
    marketplaceSourceType: "remote",
    remotePluginId: plugin.remotePluginId,
    installPolicy: "AVAILABLE",
    authPolicy: "ON_INSTALL",
    interface: null,
    manifestCategory: null,
    featured: false,
  };
}

function manifestFromCodexInterface(
  entry: CodexCatalogEntry,
  runtimeInterface: CodexRuntimePluginInterface | null,
): PluginManifest {
  const ui = runtimeInterface;
  const category = ui?.category?.trim() || entry.manifestCategory || undefined;
  const capabilities = ui?.capabilities?.filter((value) => value.trim().length > 0);
  const defaultPrompt =
    typeof ui?.defaultPrompt === "string"
      ? ui.defaultPrompt
      : ui?.defaultPrompt?.filter((value) => value.trim().length > 0);
  return {
    name: entry.name,
    version: entry.version,
    ...(ui?.shortDescription?.trim()
      ? { description: ui.shortDescription }
      : ui?.longDescription?.trim()
        ? { description: ui.longDescription }
        : {}),
    interface: {
      ...(ui?.displayName?.trim() ? { displayName: ui.displayName } : {}),
      ...(ui?.shortDescription?.trim() ? { shortDescription: ui.shortDescription } : {}),
      ...(ui?.longDescription?.trim() ? { longDescription: ui.longDescription } : {}),
      ...(ui?.developerName?.trim() ? { developerName: ui.developerName } : {}),
      ...(category ? { category } : {}),
      ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
      ...(ui?.websiteUrl?.trim() ? { websiteURL: ui.websiteUrl } : {}),
      ...(defaultPrompt && defaultPrompt.length > 0 ? { defaultPrompt } : {}),
      ...(ui?.brandColor?.trim() ? { brandColor: ui.brandColor } : {}),
    },
  };
}

function codexSourceRecord(
  entry: CodexCatalogEntry,
  remoteTwin: CodexCatalogEntry | undefined,
  runtimeAvailable: boolean,
): PluginSourceRecord {
  const runtimeInterface = entry.interface ?? remoteTwin?.interface ?? null;
  const manifest = manifestFromCodexInterface(entry, runtimeInterface);
  const isRemote = entry.marketplaceName === CODEX_CURATED_REMOTE_MARKETPLACE;
  // Codex's official catalog can be installed through the app-server for both the remote entry
  // and the local `openai-curated` snapshot copy of the same plugin.
  const codexRemote: CodexRemotePluginRef | undefined =
    isRemote ||
    remoteTwin ||
    (runtimeAvailable && entry.marketplaceName === CODEX_CURATED_MARKETPLACE)
      ? {
          pluginName: entry.name,
          marketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE,
          remotePluginId: (isRemote ? entry.remotePluginId : remoteTwin?.remotePluginId) ?? null,
        }
      : undefined;
  const remoteInstalledId = isRemote
    ? entry.installed
      ? entry.id
      : null
    : remoteTwin?.installed
      ? remoteTwin.id
      : null;
  const runtimeLogoPath = runtimeInterface?.composerIcon?.trim() || runtimeInterface?.logo?.trim();
  const externalLogoUrl =
    sanitizeRemoteUrl(runtimeInterface?.composerIconUrl ?? undefined) ??
    sanitizeRemoteUrl(runtimeInterface?.logoUrl ?? undefined);
  return {
    pluginId: publicPluginId("codex", entry.id),
    sourcePluginId: entry.id,
    harness: "codex",
    name: entry.name,
    marketplaceName: entry.marketplaceName,
    marketplaceLabel: entry.marketplaceLabel,
    version: entry.version,
    installed: entry.installed || remoteTwin?.installed === true,
    enabled: entry.enabled || remoteTwin?.enabled === true,
    pluginRoot: entry.pluginRoot,
    manifestDirectory: ".codex-plugin",
    marketplaceSourceType: entry.marketplaceSourceType,
    installPolicy: entry.installPolicy,
    authPolicy: entry.authPolicy,
    fallbackDescription: "Codex plugin",
    fallbackDisplayName: displayNameFromId(entry.name),
    fallbackDeveloper: "Unknown",
    fallbackCategory: "Other",
    fallbackHomepage: null,
    fallbackRepository: null,
    marketplaceUrl: null,
    externalLogoUrl,
    directSkills: [],
    directMcpServers: [],
    directApps: [],
    directExtensions: [],
    remotePreviewSource: null,
    hasHooks: false,
    fallbackManifest: manifest,
    featured: entry.featured || remoteTwin?.featured === true,
    runtimeLogoPath: runtimeLogoPath ?? null,
    ...(codexRemote
      ? {
          codexRemote,
          codexLegacyInstalled: isRemote ? false : entry.installed,
          codexRuntimeInstalledId: remoteInstalledId,
        }
      : {}),
  };
}

function preferCodexEntry(current: CodexCatalogEntry, next: CodexCatalogEntry): CodexCatalogEntry {
  const merged = next.interface && !current.interface ? next : current;
  return {
    ...merged,
    installed: current.installed || next.installed,
    enabled: current.enabled || next.enabled,
    pluginRoot: current.pluginRoot ?? next.pluginRoot,
    remotePluginId: current.remotePluginId ?? next.remotePluginId,
    featured: current.featured || next.featured,
  };
}

/**
 * Collapses duplicate ids (the app-server lists installed plugins twice) and pairs each local
 * `openai-curated` snapshot with its `openai-curated-remote` twin so the catalog shows one Codex
 * listing per official plugin, installed when either copy is.
 */
function mergeCodexEntries(
  entries: ReadonlyArray<CodexCatalogEntry>,
  runtimeAvailable: boolean,
): PluginSourceRecord[] {
  const byId = new Map<string, CodexCatalogEntry>();
  for (const entry of entries) {
    const current = byId.get(entry.id);
    byId.set(entry.id, current ? preferCodexEntry(current, entry) : entry);
  }
  const remoteByName = new Map<string, CodexCatalogEntry>();
  for (const entry of byId.values()) {
    if (entry.marketplaceName === CODEX_CURATED_REMOTE_MARKETPLACE) {
      remoteByName.set(entry.name.toLocaleLowerCase(), entry);
    }
  }
  const pairedRemoteIds = new Set<string>();
  const records: PluginSourceRecord[] = [];
  for (const entry of byId.values()) {
    if (entry.marketplaceName === CODEX_CURATED_REMOTE_MARKETPLACE) continue;
    const twin =
      entry.marketplaceName === CODEX_CURATED_MARKETPLACE
        ? remoteByName.get(entry.name.toLocaleLowerCase())
        : undefined;
    if (twin) pairedRemoteIds.add(twin.id);
    records.push(codexSourceRecord(entry, twin, runtimeAvailable));
  }
  for (const entry of remoteByName.values()) {
    if (pairedRemoteIds.has(entry.id)) continue;
    records.push(codexSourceRecord(entry, undefined, runtimeAvailable));
  }
  return records;
}

/** Decodes app-server `plugin/list` and `plugin/installed` payloads, skipping invalid entries. */
export function decodeCodexRuntimeCatalog(
  listResponse: unknown,
  installedResponse: unknown,
): Option.Option<CodexRuntimeCatalog> {
  const list = decodeCodexRuntimeListResponseOption(listResponse);
  const installed = decodeCodexRuntimeListResponseOption(installedResponse);
  if (Option.isNone(list) && Option.isNone(installed)) return Option.none();
  const plugins: CodexRuntimeCatalogPlugin[] = [];
  const loadErrors: string[] = [];
  for (const response of [list, installed]) {
    if (Option.isNone(response)) continue;
    for (const error of response.value.marketplaceLoadErrors ?? []) {
      const message = error.message?.trim();
      if (message) loadErrors.push(message);
    }
    for (const rawMarketplace of response.value.marketplaces) {
      const marketplace = decodeCodexRuntimeMarketplaceEntryOption(rawMarketplace);
      if (Option.isNone(marketplace)) continue;
      for (const rawPlugin of marketplace.value.plugins) {
        const summary = decodeCodexRuntimePluginSummaryOption(rawPlugin);
        if (Option.isNone(summary)) continue;
        const plugin = summary.value;
        plugins.push({
          id: plugin.id,
          name: plugin.name,
          marketplaceName: marketplace.value.name,
          marketplaceDisplayName: marketplace.value.interface?.displayName ?? null,
          marketplacePath: marketplace.value.path ?? null,
          remotePluginId: plugin.remotePluginId ?? null,
          installed: plugin.installed === true,
          enabled: plugin.enabled === true,
          version: plugin.localVersion ?? plugin.version ?? null,
          sourceType: plugin.source?.type ?? null,
          sourcePath: plugin.source?.path ?? null,
          installPolicy: plugin.installPolicy ?? null,
          authPolicy: plugin.authPolicy ?? null,
          availability: plugin.availability ?? null,
          interface: plugin.interface ?? null,
        });
      }
    }
  }
  return Option.some({
    plugins,
    featuredPluginIds: Option.isSome(list) ? (list.value.featuredPluginIds ?? []) : [],
    loadErrors,
  });
}

/** Decodes an app-server `plugin/read` payload, skipping invalid inventory entries. */
export function decodeCodexRuntimePluginDetail(
  response: unknown,
): Option.Option<CodexRuntimePluginDetail> {
  const decoded = decodeCodexRuntimeReadResponseOption(response);
  if (Option.isNone(decoded)) return Option.none();
  const plugin = decoded.value.plugin;
  return Option.some({
    description: plugin.description?.trim() || null,
    skills: (plugin.skills ?? []).flatMap((raw) => {
      const skill = decodeCodexRuntimeSkillSummaryOption(raw);
      return Option.isSome(skill)
        ? [{ name: skill.value.name, description: skill.value.description ?? null }]
        : [];
    }),
    mcpServerNames: (plugin.mcpServers ?? []).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ),
    apps: (plugin.apps ?? []).flatMap((raw) => {
      const app = decodeCodexRuntimeAppSummaryOption(raw);
      return Option.isSome(app)
        ? [
            {
              id: app.value.id,
              name: app.value.name ?? null,
              description: app.value.description ?? null,
              installUrl: app.value.installUrl ?? null,
            },
          ]
        : [];
    }),
    hookCount: plugin.hooks?.length ?? 0,
  });
}

const isProcessTimeoutError = Schema.is(ProcessRunner.ProcessTimeoutError);
const isPluginMarketplaceUnavailableError = Schema.is(PluginMarketplaceUnavailableError);

function harnessDisplayName(harness: HarnessSourceKey): string {
  return harness === "codex" ? "Codex" : harness === "claude" ? "Claude Code" : "Cursor";
}

function firstLine(value: string): string {
  const line = value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/** A short, user-facing reason a harness catalog could not be read. */
function harnessFailureDetail(
  harness: HarnessSourceKey,
  error: PluginMarketplaceUnavailableError,
): string {
  const cause = error.cause;
  if (isProcessTimeoutError(cause)) {
    return `${harnessDisplayName(harness)} did not finish listing plugins within ${Math.round(cause.timeoutMs / 1000)} seconds.`;
  }
  if (error.exitCode !== undefined) {
    return `the ${harnessDisplayName(harness)} plugin command exited with code ${error.exitCode}.`;
  }
  if (error.reason === "catalog_invalid") {
    return `${harnessDisplayName(harness)} returned a plugin catalog that could not be read.`;
  }
  if (cause instanceof Error && cause.message.trim()) return firstLine(cause.message);
  return `no ${harnessDisplayName(harness)} provider is available on this environment.`;
}

function harnessNotice(
  harness: HarnessSourceKey,
  status: PluginMarketplaceNotice["status"],
  error?: PluginMarketplaceUnavailableError,
): PluginMarketplaceNotice {
  const name = harnessDisplayName(harness);
  const detail = error ? harnessFailureDetail(harness, error) : "";
  return {
    harness,
    status,
    message:
      status === "syncing"
        ? `${name} is still syncing its plugin marketplaces. Its plugins will appear when it finishes.`
        : status === "stale"
          ? `Showing the last loaded ${name} plugins. Refresh failed: ${detail}`
          : `${name} plugins could not be loaded: ${detail}`,
  };
}

function normalizeCategory(value: string | undefined): string {
  if (!value) return "Other";
  const key = value
    .toLocaleLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
  const aliases: Readonly<Record<string, string>> = {
    "business and operations": "Business & Operations",
    "data analytics": "Data & Analytics",
    "data and analytics": "Data & Analytics",
    development: "Developer Tools",
    "developer tools": "Developer Tools",
    engineering: "Developer Tools",
    "education and research": "Education & Research",
    "inbox and collaboration": "Inbox & Collaboration",
  };
  return (
    aliases[key] ??
    key
      .split(" ")
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
}

function publicPluginId(harness: PluginSourceRecord["harness"], pluginId: string): string {
  return `${harness}:${pluginId}`;
}

function chatGptPublicSourceRecord(plugin: ChatGptPublicPlugin): PluginSourceRecord {
  const sourcePluginId = chatGptPublicPluginSourceId(plugin);
  return {
    pluginId: publicPluginId("codex", sourcePluginId),
    sourcePluginId,
    harness: "codex",
    name: plugin.name,
    marketplaceName: CHATGPT_PUBLIC_MARKETPLACE_NAME,
    marketplaceLabel: CHATGPT_PUBLIC_MARKETPLACE_NAME,
    version: plugin.version,
    installed: false,
    enabled: false,
    pluginRoot: null,
    manifestDirectory: ".codex-plugin",
    marketplaceSourceType: "remote",
    installPolicy: "EXTERNAL",
    authPolicy: "ON_INSTALL",
    fallbackDescription: plugin.description,
    fallbackDisplayName: plugin.displayName,
    fallbackDeveloper: plugin.developer,
    fallbackCategory: plugin.category,
    fallbackHomepage: plugin.homepage,
    fallbackRepository: null,
    marketplaceUrl: chatGptPublicPluginMarketplaceUrl(plugin),
    externalLogoUrl: plugin.logoUrl,
    directSkills: [],
    directMcpServers: [],
    directApps:
      plugin.appCount > 0 ? [{ id: plugin.name, name: plugin.displayName, connectorId: null }] : [],
    directExtensions: [],
    remotePreviewSource: null,
    hasHooks: false,
  };
}

function mcpHarnessLabel(harness: McpOAuthRuntime.McpOAuthHarness): string {
  return harness === "codex" ? "Codex" : harness === "claude" ? "Claude Code" : "Cursor";
}

function publicFaviconUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=128`;
  } catch {
    return null;
  }
}

function githubRepositoryParts(value: string): { owner: string; repository: string } | null {
  try {
    const url = new URL(value);
    if (url.hostname.toLocaleLowerCase() !== "github.com") return null;
    const [owner, rawRepository] = url.pathname.split("/").filter(Boolean);
    const repository = rawRepository?.replace(/\.git$/u, "");
    return owner && repository ? { owner, repository } : null;
  } catch {
    const [owner, repository] = value.split("/").filter(Boolean);
    return owner && repository ? { owner, repository: repository.replace(/\.git$/u, "") } : null;
  }
}

function githubAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const repository = githubRepositoryParts(value);
  return repository
    ? `https://github.com/${encodeURIComponent(repository.owner)}.png?size=128`
    : null;
}

function remotePluginPreviewSource(value: unknown): RemotePluginPreviewSource | null {
  const decoded = decodeMarketplacePluginSourceObject(value);
  if (Option.isNone(decoded)) return null;
  const source = decoded.value;
  const sourceUrl = source.url ?? source.repo;
  if (!sourceUrl) return null;
  const repository = githubRepositoryParts(sourceUrl);
  if (!repository) return null;
  return {
    ...repository,
    revision: source.sha ?? source.ref ?? "HEAD",
    subdirectory: (source.path ?? "").replace(/^\.\//u, "").replace(/\/$/u, ""),
    repositoryUrl: `https://github.com/${repository.owner}/${repository.repository}`,
  };
}

function remoteRawUrl(source: RemotePluginPreviewSource, relativePath: string): string {
  const pathParts = [source.subdirectory, relativePath]
    .filter(Boolean)
    .join("/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const revision = source.revision.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/${revision}/${pathParts}`;
}

function remoteBrowseUrl(source: RemotePluginPreviewSource, relativePath: string): string {
  const pathParts = [source.subdirectory, relativePath]
    .filter(Boolean)
    .join("/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const revision = source.revision.split("/").map(encodeURIComponent).join("/");
  return `${source.repositoryUrl}/blob/${revision}/${pathParts}`;
}

function marketplaceExtension(
  kind: PluginMarketplaceExtensionKind,
  name: string,
  description: string | undefined,
  sourceUrl: string | undefined,
): PluginMarketplaceExtension {
  return {
    id: `${kind}:${name}`,
    name: displayNameFromId(name),
    kind,
    description: cleanText(description, `${displayNameFromId(kind)} included in this plugin.`),
    sourceUrl: sanitizeRemoteUrl(sourceUrl),
  };
}

export function parseCursorMarketplaceHtml(html: string): unknown {
  const startToken = '\\"initialPlugins\\":';
  const endToken = ',\\"initialTemplates\\":';
  const start = html.indexOf(startToken);
  const end = html.indexOf(endToken, start);
  if (start === -1 || end === -1) throw new Error("Cursor marketplace payload was not found.");
  const escapedJson = html.slice(start + startToken.length, end);
  const json = JSON.parse(`"${escapedJson}"`) as string;
  return JSON.parse(json) as unknown;
}

function catalogPlugin(
  detail: PluginMarketplaceDetail,
  logoDataUrl: string | null,
): PluginMarketplacePlugin {
  return {
    id: detail.id,
    sourceHarness: detail.sourceHarness,
    packageName: detail.packageName,
    name: detail.name,
    summary: detail.summary,
    developer: detail.developer,
    category: detail.category,
    version: detail.version,
    marketplaceName: detail.marketplaceName,
    ...(detail.marketplaceLabel === undefined ? {} : { marketplaceLabel: detail.marketplaceLabel }),
    marketplaceSourceType: detail.marketplaceSourceType,
    ...(detail.featured === undefined ? {} : { featured: detail.featured }),
    installPolicy: detail.installPolicy,
    authPolicy: detail.authPolicy,
    installed: detail.installed,
    enabled: detail.enabled,
    brandColor: detail.brandColor,
    hasLocalLogo: detail.hasLocalLogo,
    logoDataUrl,
    logoUrl: detail.logoUrl,
    contents: detail.contents,
    support: detail.support,
  };
}

const LISTING_HARNESS_RANK: Readonly<Record<PluginMarketplaceHarnessId, number>> = {
  codex: 0,
  claude: 1,
  cursor: 2,
};

function listingGroupKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function listingHasArtwork(plugin: Pick<PluginMarketplacePlugin, "hasLocalLogo" | "logoUrl">) {
  return plugin.hasLocalLogo || Boolean(plugin.logoUrl?.trim());
}

function compareListingPlugins(
  left: Pick<
    PluginMarketplacePlugin,
    | "hasLocalLogo"
    | "id"
    | "installPolicy"
    | "installed"
    | "logoUrl"
    | "marketplaceName"
    | "sourceHarness"
  >,
  right: Pick<
    PluginMarketplacePlugin,
    | "hasLocalLogo"
    | "id"
    | "installPolicy"
    | "installed"
    | "logoUrl"
    | "marketplaceName"
    | "sourceHarness"
  >,
): number {
  return (
    Number(right.installed) - Number(left.installed) ||
    Number(listingHasArtwork(right)) - Number(listingHasArtwork(left)) ||
    Number(right.installPolicy === "AVAILABLE") - Number(left.installPolicy === "AVAILABLE") ||
    Number(right.marketplaceName !== CHATGPT_PUBLIC_MARKETPLACE_NAME) -
      Number(left.marketplaceName !== CHATGPT_PUBLIC_MARKETPLACE_NAME) ||
    LISTING_HARNESS_RANK[left.sourceHarness] - LISTING_HARNESS_RANK[right.sourceHarness] ||
    left.id.localeCompare(right.id)
  );
}

function mergeListingSupport(
  plugins: ReadonlyArray<Pick<PluginMarketplacePlugin, "support">>,
): PluginMarketplacePlugin["support"] {
  const byHarness = new Map<
    PluginMarketplaceHarnessId,
    PluginMarketplacePlugin["support"][number]
  >();
  for (const plugin of plugins) {
    for (const entry of plugin.support) {
      const current = byHarness.get(entry.harness);
      byHarness.set(entry.harness, {
        harness: entry.harness,
        mcp: Boolean(current?.mcp || entry.mcp),
        skills: Boolean(current?.skills || entry.skills),
        apps: Boolean(current?.apps || entry.apps),
      });
    }
  }
  return [...byHarness.values()].toSorted(
    (left, right) => LISTING_HARNESS_RANK[left.harness] - LISTING_HARNESS_RANK[right.harness],
  );
}

function mergeListingContents(
  plugins: ReadonlyArray<Pick<PluginMarketplacePlugin, "contents">>,
): PluginMarketplacePlugin["contents"] {
  return {
    skillCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.skillCount)),
    mcpServerCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.mcpServerCount)),
    appCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.appCount)),
    commandCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.commandCount)),
    agentCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.agentCount)),
    ruleCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.ruleCount)),
    hookCount: Math.max(0, ...plugins.map((plugin) => plugin.contents.hookCount)),
    hasHooks: plugins.some((plugin) => plugin.contents.hasHooks),
  };
}

function mergeCatalogListings(
  plugins: ReadonlyArray<PluginMarketplacePlugin>,
): PluginMarketplacePlugin[] {
  const groups = new Map<string, PluginMarketplacePlugin[]>();
  for (const plugin of plugins) {
    const key = listingGroupKey(plugin.name);
    const group = groups.get(key) ?? [];
    group.push(plugin);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const primary = [...group].toSorted(compareListingPlugins)[0]!;
      return {
        ...primary,
        installed: group.some((plugin) => plugin.installed),
        enabled: group.some((plugin) => plugin.enabled),
        support: mergeListingSupport(group),
        contents: mergeListingContents(group),
      };
    })
    .toSorted(
      (left, right) =>
        Number(right.installed) - Number(left.installed) || left.name.localeCompare(right.name),
    );
}

function listingSiblings(
  plugins: ReadonlyMap<string, LoadedPlugin>,
  plugin: LoadedPlugin,
): LoadedPlugin[] {
  const key = listingGroupKey(plugin.detail.name);
  return [...plugins.values()].filter(
    (candidate) => listingGroupKey(candidate.detail.name) === key,
  );
}

function mergeLoadedListings(plugins: ReadonlyArray<LoadedPlugin>): LoadedPlugin {
  const primary = [...plugins].toSorted((left, right) =>
    compareListingPlugins(left.detail, right.detail),
  )[0]!;
  const installTargets = [
    ...new Map(
      plugins
        .flatMap((plugin) => plugin.detail.installTargets)
        .map((target) => [target.pluginId, target]),
    ).values(),
  ];
  return {
    ...primary,
    detail: {
      ...primary.detail,
      installed: plugins.some((plugin) => plugin.detail.installed),
      enabled: plugins.some((plugin) => plugin.detail.enabled),
      support: mergeListingSupport(plugins.map((plugin) => plugin.detail)),
      contents: mergeListingContents(plugins.map((plugin) => plugin.detail)),
      installTargets,
    },
  };
}

interface PluginMarketplaceOptions {
  readonly readCursorMarketplaceHtml?: () => Effect.Effect<
    string,
    PluginMarketplaceUnavailableError
  >;
  readonly readChatGptPublicPlugins?: () => Effect.Effect<ReadonlyArray<ChatGptPublicPlugin>>;
  readonly searchChatGptPublicPlugins?: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<ChatGptPublicPlugin>>;
  readonly readRemoteText?: (url: string) => Effect.Effect<string | null>;
  readonly platform?: NodeJS.Platform;
  /** How long a catalog refresh waits for each harness before reporting it as still syncing. */
  readonly harnessSyncBudget?: Duration.Input;
  readonly codexPluginRuntime?: CodexPluginRuntime["Service"];
  readonly mcpOAuthRuntime?: McpOAuthRuntime.McpOAuthRuntime["Service"];
  readonly commands?: McpOAuthRuntime.McpOAuthRuntimeOptions["commands"];
  readonly resolveCommand?: McpOAuthRuntime.McpOAuthRuntimeOptions["resolveCommand"];
  readonly cwd?: string;
  readonly onHarnessChanged?: (
    harness: Extract<PluginMarketplaceHarnessId, "codex" | "claude">,
  ) => Effect.Effect<void>;
}

export const makeWithOptions = (options: PluginMarketplaceOptions = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const httpClient = options.readCursorMarketplaceHtml ? null : yield* HttpClient.HttpClient;
    const cachedSnapshot = yield* Ref.make<CatalogSnapshot | null>(null);
    const snapshotLock = yield* Semaphore.make(1);
    const platform = options.platform ?? (yield* HostProcessPlatform);
    const marketplaceCwd = options.cwd ?? (yield* HostProcessWorkingDirectory);
    const hostEnvironment = yield* HostProcessEnvironment;
    const commandFor = Effect.fn("CodexPluginMarketplace.commandFor")(function* (
      harness: McpOAuthRuntime.McpOAuthHarness,
      fallback: string,
    ) {
      if (options.resolveCommand) return yield* options.resolveCommand(harness);
      return options.commands?.[harness] ?? { command: fallback, env: hostEnvironment };
    });

    const safePluginAbsolutePath = Effect.fn("CodexPluginMarketplace.safePluginAbsolutePath")(
      function* (pluginRoot: string, candidatePath: string) {
        const [root, resolved] = yield* Effect.all(
          [
            fileSystem.realPath(path.resolve(pluginRoot)).pipe(Effect.option),
            fileSystem.realPath(candidatePath).pipe(Effect.option),
          ],
          { concurrency: 2 },
        );
        if (Option.isNone(root) || Option.isNone(resolved)) return null;
        const relative = path.relative(root.value, resolved.value);
        if (relative === "" || relative === ".") return resolved.value;
        if (
          relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        ) {
          return null;
        }
        return resolved.value;
      },
    );

    const safePluginPath = Effect.fn("CodexPluginMarketplace.safePluginPath")(function* (
      pluginRoot: string,
      relativePath: string,
    ) {
      if (!relativePath.startsWith("./")) return null;
      return yield* safePluginAbsolutePath(pluginRoot, path.resolve(pluginRoot, relativePath));
    });

    const readJsonFile = Effect.fn("CodexPluginMarketplace.readJsonFile")(function* <
      S extends Schema.Top,
    >(
      filePath: string,
      schema: S,
    ): Effect.fn.Return<
      S["Type"],
      PlatformError.PlatformError | Schema.SchemaError,
      S["DecodingServices"]
    > {
      const raw = yield* fileSystem.readFileString(filePath);
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(raw);
    });

    const mapMcpServers = (serverMap: typeof McpServerMap.Type) =>
      Object.entries(serverMap)
        .map(([id, server]) => {
          const environmentVariables = [
            ...(server.env_vars ?? []),
            ...(server.bearer_token_env_var ? [server.bearer_token_env_var] : []),
            ...Object.keys(server.env ?? {}),
          ].filter(
            (name, index, values) => name.trim().length > 0 && values.indexOf(name) === index,
          );
          return {
            id,
            name: displayNameFromId(id),
            transport:
              server.type === "http" || server.url ? "http" : server.command ? "stdio" : "unknown",
            url: sanitizeRemoteUrl(server.url),
            oauthResource: sanitizeRemoteUrl(server.oauth_resource),
            note: server.note ?? null,
            toolTimeoutSeconds: server.tool_timeout_sec ?? null,
            environmentVariables,
          } satisfies PluginMarketplaceMcpServer;
        })
        .toSorted((left, right) => left.name.localeCompare(right.name));

    const loadSkills = Effect.fn("CodexPluginMarketplace.loadSkills")(function* (
      record: PluginSourceRecord,
      manifest: PluginManifest,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceSkill>> {
      if (!record.pluginRoot) return record.directSkills;
      const skillsPath = typeof manifest.skills === "string" ? manifest.skills : "./skills";
      const skillsRoot = yield* safePluginPath(
        record.pluginRoot,
        skillsPath.startsWith("./") ? skillsPath : `./${skillsPath}`,
      );
      if (!skillsRoot) return record.directSkills;
      const entries = yield* fileSystem
        .readDirectory(skillsRoot)
        .pipe(Effect.orElseSucceed(() => []));

      const skills = yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const skillPath = yield* safePluginAbsolutePath(
              record.pluginRoot!,
              path.join(skillsRoot, entry, "SKILL.md"),
            );
            if (!skillPath) return null;
            const markdown = yield* fileSystem.readFileString(skillPath).pipe(Effect.option);
            if (Option.isNone(markdown)) return null;
            const frontmatter = extractFrontmatter(markdown.value);
            const metadata = frontmatter ? decodeSkillFrontmatter(frontmatter) : Option.none();
            const name = cleanText(
              Option.isSome(metadata) ? metadata.value.name : undefined,
              displayNameFromId(entry),
            );
            const skillId = cleanText(
              Option.isSome(metadata) ? metadata.value.name : undefined,
              entry,
            );
            return {
              id: skillId,
              name,
              description: cleanText(
                Option.isSome(metadata) ? metadata.value.description : undefined,
                "Bundled Codex skill.",
              ),
              invocation:
                record.harness === "codex"
                  ? `$${record.name}:${skillId}`
                  : `${record.name}:${skillId}`,
            } satisfies PluginMarketplaceSkill;
          }),
        { concurrency: 16 },
      );

      const loaded = skills
        .filter((skill): skill is PluginMarketplaceSkill => skill !== null)
        .toSorted((left, right) => left.name.localeCompare(right.name));
      return loaded.length > 0 ? loaded : record.directSkills;
    });

    const loadMcpServers = Effect.fn("CodexPluginMarketplace.loadMcpServers")(function* (
      record: PluginSourceRecord,
      manifest: PluginManifest,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceMcpServer>> {
      if (!record.pluginRoot) return record.directMcpServers;
      const configuredPath =
        typeof manifest.mcpServers === "string" ? manifest.mcpServers : "./.mcp.json";
      const mcpPath = yield* safePluginPath(
        record.pluginRoot,
        configuredPath.startsWith("./") ? configuredPath : `./${configuredPath}`,
      );
      if (!mcpPath) return record.directMcpServers;
      const raw = yield* fileSystem.readFileString(mcpPath).pipe(Effect.option);
      if (Option.isNone(raw)) return record.directMcpServers;
      const unknown = yield* decodeUnknownJson(raw.value).pipe(Effect.option);
      if (Option.isNone(unknown)) return record.directMcpServers;

      const wrapped = decodeWrappedMcpServerMap(unknown.value);
      const serverMap = Option.isSome(wrapped)
        ? (wrapped.value.mcpServers ?? wrapped.value.mcp_servers)
        : undefined;
      const decoded = serverMap ? Option.some(serverMap) : decodeMcpServerMap(unknown.value);
      if (Option.isNone(decoded)) return record.directMcpServers;

      return mapMcpServers(decoded.value);
    });

    const loadApps = Effect.fn("CodexPluginMarketplace.loadApps")(function* (
      record: PluginSourceRecord,
      manifest: PluginManifest,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceApp>> {
      if (!record.pluginRoot) return record.directApps;
      const configuredPath = typeof manifest.apps === "string" ? manifest.apps : "./.app.json";
      const appsPath = yield* safePluginPath(
        record.pluginRoot,
        configuredPath.startsWith("./") ? configuredPath : `./${configuredPath}`,
      );
      if (!appsPath) return [];
      const wrapped = yield* readJsonFile(appsPath, WrappedAppMap).pipe(Effect.option);
      if (Option.isNone(wrapped)) return [];
      return Object.entries(wrapped.value.apps)
        .map(([id, app]) => ({
          id,
          name: displayNameFromId(id),
          connectorId: app.id ?? null,
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name));
    });

    const loadLocalMarkdownExtensions = Effect.fn(
      "CodexPluginMarketplace.loadLocalMarkdownExtensions",
    )(function* (
      record: PluginSourceRecord,
      directory: string,
      kind: Extract<PluginMarketplaceExtensionKind, "command" | "agent" | "rule">,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceExtension>> {
      if (!record.pluginRoot) return [];
      const root = yield* safePluginPath(record.pluginRoot, `./${directory}`);
      if (!root) return [];
      const entries = yield* fileSystem.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
      const markdownFiles = entries.filter((entry) => entry.toLocaleLowerCase().endsWith(".md"));
      return yield* Effect.forEach(
        markdownFiles,
        (entry) =>
          Effect.gen(function* () {
            const extensionPath = yield* safePluginAbsolutePath(
              record.pluginRoot!,
              path.join(root, entry),
            );
            if (!extensionPath) return null;
            const markdown = yield* fileSystem.readFileString(extensionPath);
            const frontmatter = extractFrontmatter(markdown);
            const metadata = frontmatter ? decodeSkillFrontmatter(frontmatter) : Option.none();
            const id = entry.replace(/\.md$/iu, "");
            return marketplaceExtension(
              kind,
              Option.isSome(metadata) ? cleanText(metadata.value.name, id) : id,
              Option.isSome(metadata) ? metadata.value.description : undefined,
              undefined,
            );
          }).pipe(Effect.option),
        { concurrency: 16 },
      ).pipe(
        Effect.map((extensions) =>
          extensions.flatMap((extension) =>
            Option.isSome(extension) && extension.value !== null ? [extension.value] : [],
          ),
        ),
      );
    });

    const loadExtensions = Effect.fn("CodexPluginMarketplace.loadExtensions")(function* (
      record: PluginSourceRecord,
      defaultHooksFileExists: boolean,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceExtension>> {
      const [commands, agents, rules] = yield* Effect.all(
        [
          loadLocalMarkdownExtensions(record, "commands", "command"),
          loadLocalMarkdownExtensions(record, "agents", "agent"),
          loadLocalMarkdownExtensions(record, "rules", "rule"),
        ],
        { concurrency: 3 },
      );
      const hasDeclaredHook = record.directExtensions.some(
        (extension) => extension.kind === "hook",
      );
      const local = [
        ...commands,
        ...agents,
        ...rules,
        ...(defaultHooksFileExists || (record.hasHooks && !hasDeclaredHook)
          ? [marketplaceExtension("hook", "lifecycle-hooks", "Plugin lifecycle hooks.", undefined)]
          : []),
      ];
      const byId = new Map(
        [...record.directExtensions, ...local].map((extension) => [extension.id, extension]),
      );
      return [...byId.values()].toSorted((left, right) => left.name.localeCompare(right.name));
    });

    const findDefaultLogoPath = Effect.fn("CodexPluginMarketplace.findDefaultLogoPath")(function* (
      pluginRoot: string,
    ): Effect.fn.Return<string | null> {
      const relativeCandidates = [
        "assets/app-icon.png",
        "assets/app-icon.svg",
        "assets/logo.png",
        "assets/logo.svg",
        "assets/icon.png",
        "assets/icon.svg",
        "logo.png",
        "logo.svg",
        "icon.png",
        "icon.svg",
      ];
      const candidates = yield* Effect.forEach(
        relativeCandidates,
        (candidate) => safePluginPath(pluginRoot, `./${candidate}`),
        { concurrency: 10 },
      );
      return candidates.find((candidate): candidate is string => candidate !== null) ?? null;
    });

    const readRemoteText = Effect.fn("CodexPluginMarketplace.readRemoteText")(function* (
      url: string,
      maxBytes = 2 * 1024 * 1024,
    ): Effect.fn.Return<string | null> {
      if (options.readRemoteText) {
        const body = yield* options.readRemoteText(url);
        return body && Buffer.byteLength(body) <= maxBytes ? body : null;
      }
      if (!httpClient) return null;
      const response = yield* httpClient
        .get(url)
        .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.option);
      if (Option.isNone(response)) return null;
      const body = yield* collectUint8StreamText({
        stream: response.value.stream,
        maxBytes,
      }).pipe(Effect.option);
      if (Option.isNone(body) || body.value.truncated || body.value.invalidUtf8) return null;
      return body.value.text;
    });

    const loadRemoteMcpServers = Effect.fn("CodexPluginMarketplace.loadRemoteMcpServers")(
      function* (
        source: RemotePluginPreviewSource,
        relativePath: string,
      ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceMcpServer>> {
        const raw = yield* readRemoteText(remoteRawUrl(source, relativePath));
        if (!raw) return [];
        const unknown = yield* decodeUnknownJson(raw).pipe(Effect.option);
        if (Option.isNone(unknown)) return [];
        const wrapped = decodeWrappedMcpServerMap(unknown.value);
        const serverMap = Option.isSome(wrapped)
          ? (wrapped.value.mcpServers ?? wrapped.value.mcp_servers)
          : undefined;
        const decoded = serverMap ? Option.some(serverMap) : decodeMcpServerMap(unknown.value);
        if (Option.isNone(decoded)) return [];
        return mapMcpServers(decoded.value);
      },
    );

    const loadRemoteMarkdownDescription = Effect.fn(
      "CodexPluginMarketplace.loadRemoteMarkdownDescription",
    )(function* (
      source: RemotePluginPreviewSource,
      relativePath: string,
    ): Effect.fn.Return<{
      readonly name: string | undefined;
      readonly description: string | undefined;
    }> {
      const markdown = yield* readRemoteText(remoteRawUrl(source, relativePath), 512 * 1024);
      if (!markdown) return { name: undefined, description: undefined };
      const frontmatter = extractFrontmatter(markdown);
      const metadata = frontmatter ? decodeSkillFrontmatter(frontmatter) : Option.none();
      return Option.isSome(metadata)
        ? { name: metadata.value.name, description: metadata.value.description }
        : { name: undefined, description: undefined };
    });

    const loadRemotePreview = Effect.fn("CodexPluginMarketplace.loadRemotePreview")(function* (
      plugin: LoadedPlugin,
    ): Effect.fn.Return<PluginMarketplaceDetail> {
      let source = plugin.record.remotePreviewSource;
      if (!source || (!httpClient && !options.readRemoteText)) return plugin.detail;
      if (source.revision.includes("/")) {
        const commitUrl = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/commits/${encodeURIComponent(source.revision)}`;
        const commitRaw = yield* readRemoteText(commitUrl, 512 * 1024);
        if (!commitRaw) return plugin.detail;
        const commit = yield* decodeGitHubCommitJson(commitRaw).pipe(Effect.option);
        if (Option.isNone(commit)) return plugin.detail;
        source = { ...source, revision: commit.value.sha };
      }
      const treeUrl = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/git/trees/${encodeURIComponent(source.revision)}?recursive=1`;
      const treeRaw = yield* readRemoteText(treeUrl, 8 * 1024 * 1024);
      if (!treeRaw) return plugin.detail;
      const tree = yield* decodeGitHubTreeJson(treeRaw).pipe(Effect.option);
      if (
        Option.isNone(tree) ||
        tree.value.truncated === true ||
        tree.value.tree.length > MAX_REMOTE_TREE_ENTRIES
      ) {
        return plugin.detail;
      }
      const prefix = source.subdirectory ? `${source.subdirectory}/` : "";
      const files = tree.value.tree
        .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
        .map((entry) => entry.path.slice(prefix.length));
      const manifestPath = files.includes(`${plugin.record.manifestDirectory}/plugin.json`)
        ? `${plugin.record.manifestDirectory}/plugin.json`
        : null;
      const manifestRaw = manifestPath
        ? yield* readRemoteText(remoteRawUrl(source, manifestPath), 512 * 1024)
        : null;
      const manifest: PluginManifest = manifestRaw
        ? yield* decodePluginManifestJson(manifestRaw).pipe(
            Effect.orElseSucceed((): PluginManifest => ({})),
          )
        : {};
      const skillsDirectory =
        typeof manifest.skills === "string"
          ? manifest.skills.replace(/^\.\//u, "").replace(/\/$/u, "")
          : "skills";
      const skillPaths = files
        .filter((file) => file.startsWith(`${skillsDirectory}/`) && file.endsWith("/SKILL.md"))
        .toSorted();
      const skills = yield* Effect.forEach(
        skillPaths,
        (skillPath, index) =>
          Effect.gen(function* () {
            const pathParts = skillPath.split("/");
            const fallbackId = pathParts.at(-2) ?? `skill-${index + 1}`;
            const metadata =
              index < MAX_REMOTE_DESCRIPTION_FILES
                ? yield* loadRemoteMarkdownDescription(source, skillPath)
                : { name: undefined, description: undefined };
            const id = cleanText(metadata.name, fallbackId);
            return {
              id,
              name: displayNameFromId(id),
              description: cleanText(metadata.description, "Skill included in this plugin."),
              invocation: `${plugin.record.name}:${id}`,
            } satisfies PluginMarketplaceSkill;
          }),
        { concurrency: 12 },
      );
      const configuredMcpPath =
        typeof manifest.mcpServers === "string"
          ? manifest.mcpServers.replace(/^\.\//u, "")
          : ".mcp.json";
      const mcpServers = files.includes(configuredMcpPath)
        ? yield* loadRemoteMcpServers(source, configuredMcpPath)
        : [];
      const markdownExtensionKinds = [
        { directory: "commands", kind: "command" },
        { directory: "agents", kind: "agent" },
        { directory: "rules", kind: "rule" },
      ] as const;
      const extensionPaths = markdownExtensionKinds.flatMap(({ directory, kind }) =>
        files
          .filter(
            (file) =>
              file.startsWith(`${directory}/`) &&
              file.endsWith(".md") &&
              !file.slice(directory.length + 1).includes("/"),
          )
          .map((file) => ({ file, kind })),
      );
      const markdownExtensions = yield* Effect.forEach(
        extensionPaths,
        ({ file, kind }, index) =>
          Effect.gen(function* () {
            const fallbackName = file.split("/").at(-1)?.replace(/\.md$/iu, "") ?? kind;
            const metadata =
              index < MAX_REMOTE_DESCRIPTION_FILES
                ? yield* loadRemoteMarkdownDescription(source, file)
                : { name: undefined, description: undefined };
            return marketplaceExtension(
              kind,
              cleanText(metadata.name, fallbackName),
              metadata.description,
              remoteBrowseUrl(source, file),
            );
          }),
        { concurrency: 12 },
      );
      const extensions = [
        ...markdownExtensions,
        ...(files.includes("hooks/hooks.json")
          ? [
              marketplaceExtension(
                "hook",
                "lifecycle-hooks",
                "Plugin lifecycle hooks.",
                remoteBrowseUrl(source, "hooks/hooks.json"),
              ),
            ]
          : []),
        ...(files.includes(".lsp.json")
          ? [
              marketplaceExtension(
                "lsp",
                "language-servers",
                "Language server configuration.",
                remoteBrowseUrl(source, ".lsp.json"),
              ),
            ]
          : []),
        ...(files.includes("monitors/monitors.json")
          ? [
              marketplaceExtension(
                "monitor",
                "background-monitors",
                "Background monitor configuration.",
                remoteBrowseUrl(source, "monitors/monitors.json"),
              ),
            ]
          : []),
      ].toSorted((left, right) => left.name.localeCompare(right.name));
      const contents = {
        skillCount: skills.length,
        mcpServerCount: mcpServers.length,
        appCount: 0,
        commandCount: extensions.filter((extension) => extension.kind === "command").length,
        agentCount: extensions.filter((extension) => extension.kind === "agent").length,
        ruleCount: extensions.filter((extension) => extension.kind === "rule").length,
        hookCount: extensions.filter((extension) => extension.kind === "hook").length,
        hasHooks: extensions.some((extension) => extension.kind === "hook"),
      };
      const configuredLogo =
        manifest.interface?.logo ?? manifest.interface?.composerIcon ?? manifest.logo;
      const logoPath =
        typeof configuredLogo === "string"
          ? configuredLogo.replace(/^\.\//u, "")
          : files.find((file) =>
              /(^|\/)(app-icon|logo|icon|[^/]+ icon(?: \(full-color\))?)\.(png|jpe?g|webp|svg)$/iu.test(
                file,
              ),
            );
      const packageName = cleanText(manifest.name, plugin.detail.packageName);
      const name = cleanText(
        manifest.interface?.displayName ?? manifest.displayName,
        plugin.detail.name,
      );
      const summary = cleanText(
        manifest.interface?.shortDescription,
        cleanText(manifest.description, plugin.detail.summary),
      );
      const support = plugin.detail.support.map((entry) =>
        entry.harness === plugin.record.harness
          ? {
              ...entry,
              mcp: mcpServers.length > 0,
              skills: skills.length > 0,
              apps: false,
            }
          : entry,
      );
      return {
        ...plugin.detail,
        packageName,
        name,
        summary,
        description: cleanText(manifest.interface?.longDescription, summary),
        developer: manifestDeveloper(manifest, plugin.detail.developer),
        version: cleanText(manifest.version, plugin.detail.version),
        homepage: sanitizeRemoteUrl(
          manifest.interface?.websiteURL ??
            manifest.homepage ??
            plugin.detail.homepage ??
            undefined,
        ),
        repository: sanitizeRemoteUrl(
          manifest.repository ?? plugin.detail.repository ?? source.repositoryUrl,
        ),
        logoUrl: logoPath ? remoteRawUrl(source, logoPath) : plugin.detail.logoUrl,
        contents,
        support,
        skills,
        mcpServers,
        extensions,
        installTargets: plugin.detail.installTargets.map((target) =>
          target.pluginId === plugin.detail.id ? { ...target, contents } : target,
        ),
      };
    });

    const loadPlugin = Effect.fn("CodexPluginMarketplace.loadPlugin")(function* (
      record: PluginSourceRecord,
    ): Effect.fn.Return<LoadedPlugin> {
      const manifestPath = record.pluginRoot
        ? yield* safePluginPath(record.pluginRoot, `./${record.manifestDirectory}/plugin.json`)
        : null;
      const fallbackManifest: PluginManifest = record.fallbackManifest ?? {
        name: record.name,
        version: record.version,
        description: record.fallbackDescription,
      };
      const diskManifest = manifestPath
        ? yield* readJsonFile(manifestPath, PluginManifest).pipe(Effect.option)
        : Option.none();
      // The package manifest on disk wins field by field; marketplace metadata fills the gaps.
      const manifest: PluginManifest = Option.isSome(diskManifest)
        ? {
            ...fallbackManifest,
            ...diskManifest.value,
            interface: { ...fallbackManifest.interface, ...diskManifest.value.interface },
          }
        : fallbackManifest;
      const [skills, mcpServers, apps, defaultHooksFileExists] = yield* Effect.all(
        [
          loadSkills(record, manifest),
          loadMcpServers(record, manifest),
          loadApps(record, manifest),
          record.pluginRoot
            ? fileSystem
                .exists(path.join(record.pluginRoot, "hooks", "hooks.json"))
                .pipe(Effect.orElseSucceed(() => false))
            : Effect.succeed(false),
        ],
        { concurrency: 4 },
      );
      const extensions = yield* loadExtensions(record, defaultHooksFileExists);
      const packageName = cleanText(manifest.name, record.name);
      const name = cleanText(
        manifest.interface?.displayName ?? manifest.displayName,
        cleanText(record.fallbackDisplayName, displayNameFromId(packageName)),
      );
      const summary = cleanText(
        manifest.interface?.shortDescription,
        cleanText(manifest.description, record.fallbackDescription),
      );
      const description = cleanText(
        manifest.interface?.longDescription,
        cleanText(manifest.description, summary),
      );
      const logoRelativePath =
        manifest.interface?.logo ?? manifest.interface?.composerIcon ?? manifest.logo;
      const configuredLogoPath =
        logoRelativePath && record.pluginRoot
          ? yield* safePluginPath(
              record.pluginRoot,
              logoRelativePath.startsWith("./") ? logoRelativePath : `./${logoRelativePath}`,
            )
          : null;
      const runtimeLogoPath =
        record.runtimeLogoPath && record.pluginRoot
          ? yield* safePluginAbsolutePath(record.pluginRoot, record.runtimeLogoPath)
          : null;
      const logoPath =
        configuredLogoPath ??
        runtimeLogoPath ??
        (record.pluginRoot ? yield* findDefaultLogoPath(record.pluginRoot) : null);
      const homepage = sanitizeRemoteUrl(
        manifest.interface?.websiteURL ?? manifest.homepage ?? record.fallbackHomepage ?? undefined,
      );
      const repository = sanitizeRemoteUrl(
        manifest.repository ?? record.fallbackRepository ?? undefined,
      );
      const support = [
        {
          harness: record.harness,
          mcp: mcpServers.length > 0,
          skills: skills.length > 0,
          apps: apps.length > 0,
        },
      ];
      const defaultPrompts =
        typeof manifest.interface?.defaultPrompt === "string"
          ? [manifest.interface.defaultPrompt]
          : (manifest.interface?.defaultPrompt ?? []);

      return {
        record,
        logoPath,
        detail: {
          id: record.pluginId,
          sourceHarness: record.harness,
          packageName,
          name,
          summary,
          description,
          developer: manifestDeveloper(manifest, record.fallbackDeveloper),
          category: normalizeCategory(
            cleanText(manifest.interface?.category, record.fallbackCategory),
          ),
          version: cleanText(manifest.version, record.version),
          marketplaceName: record.marketplaceName,
          marketplaceLabel: record.marketplaceLabel,
          marketplaceSourceType: record.marketplaceSourceType,
          ...(record.featured ? { featured: true } : {}),
          installPolicy: record.installPolicy,
          authPolicy: record.authPolicy,
          installed: record.installed,
          enabled: record.enabled,
          brandColor: manifest.interface?.brandColor?.trim() || null,
          hasLocalLogo: logoPath !== null,
          logoDataUrl: null,
          logoUrl:
            record.externalLogoUrl ??
            publicFaviconUrl(homepage) ??
            githubAvatarUrl(repository) ??
            publicFaviconUrl(repository),
          contents: {
            skillCount: skills.length,
            mcpServerCount: mcpServers.length,
            appCount: apps.length,
            commandCount: extensions.filter((extension) => extension.kind === "command").length,
            agentCount: extensions.filter((extension) => extension.kind === "agent").length,
            ruleCount: extensions.filter((extension) => extension.kind === "rule").length,
            hookCount: extensions.filter((extension) => extension.kind === "hook").length,
            hasHooks: extensions.some((extension) => extension.kind === "hook"),
          },
          support,
          marketplaceUrl:
            record.marketplaceName === CHATGPT_PUBLIC_MARKETPLACE_NAME
              ? record.marketplaceUrl
              : sanitizeRemoteUrl(record.marketplaceUrl ?? undefined),
          homepage,
          repository,
          capabilities: manifest.interface?.capabilities ?? [],
          defaultPrompts,
          skills,
          mcpServers,
          apps,
          extensions,
          installTargets: [],
        },
      };
    });

    const inferCodexHome = (pluginRoot: string): string | null => {
      const temporaryDirectoryMarker = `${path.sep}.tmp${path.sep}`;
      const temporaryDirectoryIndex = pluginRoot.indexOf(temporaryDirectoryMarker);
      if (temporaryDirectoryIndex > 0) return pluginRoot.slice(0, temporaryDirectoryIndex);

      const configuredHome = hostEnvironment.CODEX_HOME?.trim();
      if (configuredHome) return configuredHome;
      const userHome = hostEnvironment.HOME?.trim() || hostEnvironment.USERPROFILE?.trim();
      return userHome ? path.join(userHome, ".codex") : null;
    };

    // The CLI JSON carries no display metadata, so read each local marketplace manifest once for
    // its display name and per-plugin categories.
    const readCodexMarketplaceManifests = Effect.fn(
      "CodexPluginMarketplace.readCodexMarketplaceManifests",
    )(function* (records: ReadonlyArray<CodexPluginRecord>) {
      const roots = new Map<string, string>();
      for (const record of records) {
        const source = record.marketplaceSource;
        if (source?.sourceType === "local" && source.source.trim()) {
          roots.set(record.marketplaceName, source.source);
        }
      }
      const manifests = yield* Effect.forEach(
        [...roots.entries()],
        ([marketplaceName, root]) =>
          Effect.gen(function* () {
            const manifestPath = yield* safePluginPath(root, "./.agents/plugins/marketplace.json");
            const manifest = manifestPath
              ? yield* readJsonFile(manifestPath, MarketplaceManifest).pipe(Effect.option)
              : Option.none();
            return [marketplaceName, Option.getOrNull(manifest)] as const;
          }),
        { concurrency: 4 },
      );
      return new Map(manifests);
    });

    const readCodexPluginRecords = Effect.fn("CodexPluginMarketplace.readCodexPluginRecords")(
      function* () {
        const runtime = options.codexPluginRuntime;
        // The app-server catalog is how the Codex app itself lists plugins: one fast call with
        // display metadata for local and remote marketplaces alike. The CLI is the fallback.
        if (runtime?.list) {
          const listed = yield* runtime.list().pipe(Effect.result);
          if (Result.isSuccess(listed)) {
            const featured = new Set(listed.success.featuredPluginIds);
            return mergeCodexEntries(
              listed.success.plugins.map((plugin) =>
                codexEntryFromRuntimePlugin(plugin, featured, (value) => path.isAbsolute(value)),
              ),
              true,
            );
          }
          yield* Effect.logDebug(
            `Codex app-server plugin catalog unavailable, using the CLI: ${String(listed.failure)}`,
          );
        }
        const command = yield* commandFor("codex", "codex");
        if (!command) {
          return yield* new PluginMarketplaceUnavailableError({
            reason: "codex_unavailable",
          });
        }
        const [result, runtimeInstalled] = yield* Effect.all(
          [
            processRunner.run({
              command: command.command,
              args: ["plugin", "list", "--available", "--json"],
              cwd: marketplaceCwd,
              env: command.env,
              timeout: CODEX_PLUGIN_LIST_TIMEOUT,
              maxOutputBytes: 32 * 1024 * 1024,
            }),
            runtime ? runtime.installed().pipe(Effect.result) : Effect.succeed(null),
          ],
          { concurrency: 2 },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new PluginMarketplaceUnavailableError({ reason: "codex_unavailable", cause }),
          ),
        );
        if (result.code !== 0 || result.stdoutInvalidUtf8 || result.stdoutTruncated) {
          return yield* new PluginMarketplaceUnavailableError({
            reason: "codex_unavailable",
            ...(result.code === null ? {} : { exitCode: result.code }),
          });
        }
        const decoded = yield* decodeCodexPluginListJson(result.stdout).pipe(
          Effect.mapError(
            (cause) => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid", cause }),
          ),
        );
        // Decode one record at a time so a single unexpected entry cannot sink every Codex plugin.
        const rawRecords = [...decoded.installed, ...decoded.available];
        const records = rawRecords.flatMap((raw) => {
          const record = decodeCodexPluginRecordOption(raw);
          return Option.isSome(record) ? [record.value] : [];
        });
        if (records.length === 0 && rawRecords.length > 0) {
          return yield* new PluginMarketplaceUnavailableError({ reason: "catalog_invalid" });
        }
        if (records.length < rawRecords.length) {
          yield* Effect.logWarning(
            `Skipped ${rawRecords.length - records.length} unreadable Codex plugin records.`,
          );
        }
        const manifests = yield* readCodexMarketplaceManifests(records);
        const entries = records.map((record) => {
          const manifest = manifests.get(record.marketplaceName);
          return codexEntryFromCliRecord(
            record,
            manifest
              ? {
                  label: marketplaceLabel(record.marketplaceName, manifest.interface?.displayName),
                  category:
                    manifest.plugins.find((plugin) => plugin.name === record.name)?.category ??
                    null,
                }
              : undefined,
          );
        });
        const runtimeAvailable = runtimeInstalled !== null && Result.isSuccess(runtimeInstalled);
        if (runtimeAvailable) {
          const known = new Set(entries.map((entry) => entry.id));
          for (const plugin of runtimeInstalled.success) {
            if (
              plugin.marketplaceName !== CODEX_CURATED_REMOTE_MARKETPLACE ||
              known.has(plugin.id)
            ) {
              continue;
            }
            entries.push(codexEntryFromInstalledRuntimePlugin(plugin));
          }
        }
        return mergeCodexEntries(entries, runtimeAvailable);
      },
    );

    const readClaudePluginRecords = Effect.fn("CodexPluginMarketplace.readClaudePluginRecords")(
      function* () {
        const command = yield* commandFor("claude", "claude");
        if (!command) {
          return yield* new PluginMarketplaceUnavailableError({
            reason: "marketplaces_unavailable",
          });
        }
        const [pluginsResult, marketplacesResult] = yield* Effect.all(
          [
            processRunner.run({
              command: command.command,
              args: ["plugin", "list", "--available", "--json"],
              cwd: marketplaceCwd,
              env: command.env,
              timeout: "30 seconds",
              maxOutputBytes: 8 * 1024 * 1024,
            }),
            processRunner.run({
              command: command.command,
              args: ["plugin", "marketplace", "list", "--json"],
              cwd: marketplaceCwd,
              env: command.env,
              timeout: "30 seconds",
              maxOutputBytes: 1024 * 1024,
            }),
          ],
          { concurrency: 2 },
        );
        if (
          pluginsResult.code !== 0 ||
          pluginsResult.stdoutInvalidUtf8 ||
          pluginsResult.stdoutTruncated
        ) {
          return yield* new PluginMarketplaceUnavailableError({
            reason: "marketplaces_unavailable",
            ...(pluginsResult.code === null ? {} : { exitCode: pluginsResult.code }),
          });
        }
        const pluginList = yield* decodeClaudePluginListJson(pluginsResult.stdout).pipe(
          Effect.mapError(
            (cause) => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid", cause }),
          ),
        );
        const marketplaces =
          marketplacesResult.code === 0
            ? yield* decodeClaudeMarketplaceListJson(marketplacesResult.stdout).pipe(
                Effect.orElseSucceed(() => []),
              )
            : [];
        const marketplaceRoots = new Map(
          marketplaces.map((marketplace) => [marketplace.name, marketplace.installLocation]),
        );
        const marketplaceMetadata = new Map<string, MarketplaceManifestPlugin>();
        for (const marketplace of marketplaces) {
          const manifestPath = yield* safePluginPath(
            marketplace.installLocation,
            "./.claude-plugin/marketplace.json",
          );
          if (!manifestPath) continue;
          const manifest = yield* readJsonFile(manifestPath, MarketplaceManifest).pipe(
            Effect.option,
          );
          if (Option.isNone(manifest)) continue;
          for (const plugin of manifest.value.plugins) {
            marketplaceMetadata.set(`${plugin.name}@${marketplace.name}`, plugin);
          }
        }

        const installed = new Map(pluginList.installed.map((plugin) => [plugin.id, plugin]));
        const available = new Map(pluginList.available.map((plugin) => [plugin.pluginId, plugin]));
        for (const plugin of pluginList.installed) {
          if (available.has(plugin.id)) continue;
          const separator = plugin.id.lastIndexOf("@");
          const name = separator === -1 ? plugin.id : plugin.id.slice(0, separator);
          const marketplaceName =
            separator === -1 ? "claude-local" : plugin.id.slice(separator + 1);
          const metadata = marketplaceMetadata.get(plugin.id);
          available.set(plugin.id, {
            pluginId: plugin.id,
            name,
            description: metadata?.description ?? "Installed Claude Code plugin",
            marketplaceName,
            source: metadata?.source ?? "installed",
            installCount: undefined,
          });
        }

        return yield* Effect.forEach(available.values(), (plugin) =>
          Effect.gen(function* () {
            const installedPlugin = installed.get(plugin.pluginId);
            const metadata = marketplaceMetadata.get(plugin.pluginId);
            const marketplaceRoot = marketplaceRoots.get(plugin.marketplaceName);
            const localSource = typeof plugin.source === "string" ? plugin.source : null;
            const marketplacePath =
              marketplaceRoot && localSource?.startsWith("./")
                ? yield* safePluginPath(marketplaceRoot, localSource)
                : null;
            const author = metadata?.author;
            const developer =
              typeof author === "string" ? author : cleanText(author?.name, "Claude Marketplace");
            const previewSource = remotePluginPreviewSource(plugin.source);
            const homepage = sanitizeRemoteUrl(metadata?.homepage);
            return {
              pluginId: publicPluginId("claude", plugin.pluginId),
              sourcePluginId: plugin.pluginId,
              harness: "claude",
              name: plugin.name,
              marketplaceName: plugin.marketplaceName,
              marketplaceLabel: marketplaceLabel(plugin.marketplaceName),
              version: installedPlugin?.version ?? metadata?.version ?? "Latest",
              installed: installedPlugin !== undefined,
              enabled: installedPlugin?.enabled ?? false,
              pluginRoot: installedPlugin?.installPath ?? marketplacePath,
              manifestDirectory: ".claude-plugin",
              marketplaceSourceType: localSource ? "local" : "git",
              installPolicy: "AVAILABLE",
              authPolicy: "ON_INSTALL",
              fallbackDescription: cleanText(metadata?.description, plugin.description),
              fallbackDisplayName: cleanText(metadata?.displayName, displayNameFromId(plugin.name)),
              fallbackDeveloper: developer,
              fallbackCategory: normalizeCategory(metadata?.category),
              fallbackHomepage: homepage,
              fallbackRepository: previewSource?.repositoryUrl ?? null,
              marketplaceUrl: null,
              externalLogoUrl:
                publicFaviconUrl(homepage) ?? githubAvatarUrl(previewSource?.repositoryUrl),
              directSkills: [],
              directMcpServers: [],
              directApps: [],
              directExtensions: [],
              remotePreviewSource: previewSource,
              hasHooks: false,
            } satisfies PluginSourceRecord;
          }),
        );
      },
    );

    const readCursorPluginRecords = Effect.fn("CodexPluginMarketplace.readCursorPluginRecords")(
      function* () {
        const html = yield* options.readCursorMarketplaceHtml
          ? options.readCursorMarketplaceHtml()
          : Effect.gen(function* () {
              if (!httpClient) {
                return yield* new PluginMarketplaceUnavailableError({
                  reason: "marketplaces_unavailable",
                });
              }
              const response = yield* httpClient.get("https://cursor.com/marketplace").pipe(
                Effect.flatMap(HttpClientResponse.filterStatusOk),
                Effect.mapError(
                  (cause) =>
                    new PluginMarketplaceUnavailableError({
                      reason: "marketplaces_unavailable",
                      cause,
                    }),
                ),
              );
              const body = yield* response.text.pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginMarketplaceUnavailableError({
                      reason: "marketplaces_unavailable",
                      cause,
                    }),
                ),
              );
              if (body.length > 8 * 1024 * 1024) {
                return yield* new PluginMarketplaceUnavailableError({
                  reason: "catalog_invalid",
                });
              }
              return body;
            });
        const parsed = yield* Effect.try({
          try: () => parseCursorMarketplaceHtml(html),
          catch: (cause) =>
            new PluginMarketplaceUnavailableError({ reason: "catalog_invalid", cause }),
        });
        const plugins = yield* decodeCursorMarketplacePlugins(parsed).pipe(
          Effect.mapError(
            (cause) => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid", cause }),
          ),
        );
        const home = hostEnvironment.HOME ?? hostEnvironment.USERPROFILE;
        return yield* Effect.forEach(
          plugins,
          (plugin): Effect.Effect<PluginSourceRecord> =>
            Effect.gen(function* () {
              const marketplaceName = plugin.marketplace?.name ?? "cursor-public";
              const cachePath = home
                ? path.join(home, ".cursor", "plugins", "cache", marketplaceName, plugin.name)
                : null;
              const installed = cachePath
                ? yield* fileSystem.exists(cachePath).pipe(Effect.orElseSucceed(() => false))
                : false;
              const category = normalizeCategory(plugin.curatedCategoryKeys?.[0]);
              const skills = (plugin.skills ?? []).map((skill): PluginMarketplaceSkill => ({
                id: skill.name,
                name: displayNameFromId(skill.name),
                description: cleanText(skill.description, "Cursor skill"),
                invocation: skill.name,
              }));
              const mcpServers = (plugin.mcpServers ?? []).map(
                (server): PluginMarketplaceMcpServer => ({
                  id: server.name,
                  name: displayNameFromId(server.name),
                  transport: "unknown",
                  url: null,
                  oauthResource: null,
                  note: sanitizeRemoteUrl(server.sourceUrl) ?? "Configuration supplied by Cursor.",
                  toolTimeoutSeconds: null,
                  environmentVariables: [],
                }),
              );
              const publisherName = plugin.publisher?.name ?? "cursor";
              const extensions = [
                ...(plugin.commands ?? []).map((extension) =>
                  marketplaceExtension(
                    "command",
                    extension.name,
                    extension.description,
                    extension.sourceUrl,
                  ),
                ),
                ...(plugin.subagents ?? []).map((extension) =>
                  marketplaceExtension(
                    "agent",
                    extension.name,
                    extension.description,
                    extension.sourceUrl,
                  ),
                ),
                ...(plugin.rules ?? []).map((extension) =>
                  marketplaceExtension(
                    "rule",
                    extension.name,
                    extension.description,
                    extension.sourceUrl,
                  ),
                ),
                ...(plugin.hooks ?? []).map((extension) =>
                  marketplaceExtension(
                    "hook",
                    extension.name,
                    extension.description,
                    extension.sourceUrl,
                  ),
                ),
              ];
              return {
                pluginId: publicPluginId("cursor", plugin.id),
                sourcePluginId: plugin.id,
                harness: "cursor",
                name: plugin.name,
                marketplaceName: plugin.marketplace?.displayName ?? "Cursor Marketplace",
                marketplaceLabel: plugin.marketplace?.displayName ?? "Cursor Marketplace",
                version: plugin.gitRef?.slice(0, 7) ?? "Current",
                installed,
                enabled: installed,
                pluginRoot: null,
                manifestDirectory: ".cursor-plugin",
                marketplaceSourceType: "git",
                installPolicy: "EXTERNAL",
                authPolicy: "ON_INSTALL",
                fallbackDescription: cleanText(plugin.description, "Cursor plugin"),
                fallbackDisplayName: plugin.displayName ?? displayNameFromId(plugin.name),
                fallbackDeveloper: plugin.publisher?.displayName ?? publisherName,
                fallbackCategory: category,
                fallbackHomepage: sanitizeRemoteUrl(plugin.publisher?.websiteUrl),
                fallbackRepository: sanitizeRemoteUrl(plugin.repositoryUrl),
                marketplaceUrl: `https://cursor.com/marketplace/${encodeURIComponent(publisherName)}/${encodeURIComponent(plugin.name)}`,
                externalLogoUrl:
                  sanitizeRemoteUrl(plugin.logoUrl) ??
                  sanitizeRemoteUrl(plugin.publisher?.logoUrl) ??
                  publicFaviconUrl(plugin.publisher?.websiteUrl),
                directSkills: skills,
                directMcpServers: mcpServers,
                directApps: [],
                directExtensions: extensions,
                remotePreviewSource: null,
                hasHooks: (plugin.hooks?.length ?? 0) > 0,
              };
            }),
          { concurrency: 32 },
        );
      },
    );

    const readCodexChatGptAuth = Effect.fn("CodexPluginMarketplace.readCodexChatGptAuth")(
      function* () {
        const command = yield* commandFor("codex", "codex");
        const userHome = hostEnvironment.HOME?.trim() || hostEnvironment.USERPROFILE?.trim();
        const home =
          command?.env.CODEX_HOME?.trim() ||
          hostEnvironment.CODEX_HOME?.trim() ||
          (userHome ? path.join(userHome, ".codex") : null);
        if (!home) return null;
        const encoded = yield* fileSystem
          .readFileString(path.join(home, "auth.json"))
          .pipe(Effect.option);
        if (Option.isNone(encoded)) return null;
        const decoded = yield* decodeCodexChatGptAccessToken(encoded.value).pipe(Effect.option);
        return Option.isSome(decoded) ? codexChatGptAuthFromTokens(decoded.value.tokens) : null;
      },
    );

    const fetchChatGptPublicPage = Effect.fn("CodexPluginMarketplace.fetchChatGptPublicPage")(
      function* (url: string) {
        if (!httpClient) return null;
        const auth = yield* readCodexChatGptAuth();
        if (!auth) return null;
        let request = HttpClientRequest.get(url).pipe(
          HttpClientRequest.bearerToken(auth.accessToken),
          HttpClientRequest.setHeader("OAI-Product-Sku", "chatgpt"),
          HttpClientRequest.acceptJson,
        );
        if (auth.accountId) {
          request = request.pipe(HttpClientRequest.setHeader("ChatGPT-Account-Id", auth.accountId));
        }
        const response = yield* httpClient.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((ok) => ok.json),
        );
        return yield* decodeChatGptPublicPluginListResponse(response);
      },
    );

    const fetchChatGptPublicPluginPages = Effect.fn(
      "CodexPluginMarketplace.fetchChatGptPublicPluginPages",
    )(function* (urlForPage: (pageToken?: string) => string, maxPages: number) {
      const plugins: ChatGptPublicPlugin[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < maxPages; page += 1) {
        const decoded = yield* fetchChatGptPublicPage(urlForPage(pageToken));
        if (!decoded) break;
        plugins.push(...chatGptPublicPluginsFromListResponse(decoded));
        const next = decoded.pagination?.next_page_token?.trim();
        if (!next) break;
        pageToken = next;
      }
      return plugins;
    });

    const fetchChatGptPublicSearchPlugins = Effect.fn(
      "CodexPluginMarketplace.fetchChatGptPublicSearchPlugins",
    )(function* (query: string) {
      return yield* fetchChatGptPublicPluginPages(
        (pageToken) => chatGptPublicPluginSearchUrl(query, pageToken),
        CHATGPT_PUBLIC_PLUGIN_SEARCH_MAX_PAGES,
      );
    });

    const readChatGptPublicPluginRecords = Effect.fn(
      "CodexPluginMarketplace.readChatGptPublicPluginRecords",
    )(function* () {
      const plugins = options.readChatGptPublicPlugins
        ? yield* options.readChatGptPublicPlugins()
        : [];
      return plugins.map(chatGptPublicSourceRecord);
    });

    const searchChatGptPublicPluginRecords = Effect.fn(
      "CodexPluginMarketplace.searchChatGptPublicPluginRecords",
    )(function* (query: string) {
      const plugins = options.searchChatGptPublicPlugins
        ? yield* options.searchChatGptPublicPlugins(query)
        : yield* fetchChatGptPublicSearchPlugins(query).pipe(Effect.orElseSucceed(() => []));
      return plugins.map(chatGptPublicSourceRecord);
    });

    const withInstallTarget = (plugin: LoadedPlugin): LoadedPlugin => ({
      ...plugin,
      detail: {
        ...plugin.detail,
        installTargets: [
          {
            pluginId: plugin.detail.id,
            harness: plugin.detail.sourceHarness,
            marketplaceName: plugin.detail.marketplaceName,
            marketplaceLabel: plugin.record.marketplaceLabel,
            version: plugin.detail.version,
            installed: plugin.record.installed,
            enabled: plugin.record.enabled,
            installPolicy: plugin.detail.installPolicy,
            marketplaceUrl: plugin.detail.marketplaceUrl,
            contents: plugin.detail.contents,
          },
        ],
      },
    });

    // Each harness is read on its own background fiber so a slow harness never blocks the others.
    // A refresh waits at most HARNESS_SYNC_BUDGET per harness, then returns what it has with a
    // "syncing" notice; when the read finishes it invalidates the cached snapshot so the next
    // request includes that harness. A failed read keeps the last good records with a notice.
    const sourceScope = yield* Scope.make();
    const lastGoodSources = yield* Ref.make(
      new Map<HarnessSourceKey, ReadonlyArray<PluginSourceRecord>>(),
    );
    const inflightSources = yield* Ref.make(
      new Map<HarnessSourceKey, Deferred.Deferred<HarnessSourceResult>>(),
    );

    const startSourceRead = Effect.fn("CodexPluginMarketplace.startSourceRead")(function* <E>(
      harness: HarnessSourceKey,
      read: () => Effect.Effect<ReadonlyArray<PluginSourceRecord>, E>,
    ) {
      const deferred = yield* Deferred.make<HarnessSourceResult>();
      yield* Ref.update(inflightSources, (current) => new Map(current).set(harness, deferred));
      yield* read().pipe(
        Effect.mapError((error) =>
          isPluginMarketplaceUnavailableError(error)
            ? error
            : new PluginMarketplaceUnavailableError({
                reason: "marketplaces_unavailable",
                cause: error,
              }),
        ),
        Effect.result,
        Effect.flatMap((result) =>
          Effect.gen(function* () {
            if (Result.isSuccess(result)) {
              yield* Ref.update(lastGoodSources, (current) =>
                new Map(current).set(harness, result.success),
              );
            }
            yield* Ref.update(inflightSources, (current) => {
              if (current.get(harness) !== deferred) return current;
              const next = new Map(current);
              next.delete(harness);
              return next;
            });
            const cached = yield* Ref.get(cachedSnapshot);
            if (
              cached?.notices.some(
                (notice) => notice.harness === harness && notice.status === "syncing",
              )
            ) {
              yield* Ref.set(cachedSnapshot, null);
            }
            yield* Deferred.succeed(deferred, result);
          }),
        ),
        Effect.forkIn(sourceScope),
      );
      return deferred;
    });

    const readSource = Effect.fn("CodexPluginMarketplace.readSource")(function* <E>(
      harness: HarnessSourceKey,
      read: () => Effect.Effect<ReadonlyArray<PluginSourceRecord>, E>,
    ) {
      const deferred =
        (yield* Ref.get(inflightSources)).get(harness) ?? (yield* startSourceRead(harness, read));
      const awaited = yield* Deferred.await(deferred).pipe(
        Effect.timeoutOption(options.harnessSyncBudget ?? HARNESS_SYNC_BUDGET),
      );
      const lastGood = (yield* Ref.get(lastGoodSources)).get(harness);
      if (Option.isNone(awaited)) {
        return {
          records: lastGood ?? [],
          notice: harnessNotice(harness, "syncing"),
          pending: true,
          failure: null,
        };
      }
      if (Result.isSuccess(awaited.value)) {
        return { records: awaited.value.success, notice: null, pending: false, failure: null };
      }
      return {
        records: lastGood ?? [],
        notice: harnessNotice(harness, lastGood ? "stale" : "failed", awaited.value.failure),
        pending: false,
        failure: awaited.value.failure,
      };
    });

    const refreshSnapshot = Effect.fn("CodexPluginMarketplace.refreshSnapshot")(function* () {
      const [codex, claude, cursor, chatGpt] = yield* Effect.all(
        [
          readSource("codex", readCodexPluginRecords),
          readSource("claude", readClaudePluginRecords),
          readSource("cursor", readCursorPluginRecords),
          readChatGptPublicPluginRecords(),
        ],
        { concurrency: 4 },
      );
      const sources = [codex, claude, cursor];
      const notices = sources.flatMap((source) => (source.notice ? [source.notice] : []));
      const sourceRecords = [...sources.flatMap((source) => source.records), ...chatGpt];
      if (sourceRecords.length === 0 && !sources.some((source) => source.pending)) {
        const causes = sources.flatMap((source) => (source.failure ? [source.failure] : []));
        return yield* new PluginMarketplaceUnavailableError({
          reason: "marketplaces_unavailable",
          ...(causes.length === 0
            ? {}
            : { cause: causes.length === 1 ? causes[0] : new AggregateError(causes) }),
        });
      }
      const sourcePlugins = yield* Effect.forEach(sourceRecords, loadPlugin, {
        concurrency: 16,
      });
      const loadedPlugins = sourcePlugins.map(withInstallTarget);
      const catalogPlugins = yield* Effect.forEach(
        loadedPlugins,
        (plugin) =>
          loadLogoDataUrl(
            plugin.detail.installed ? plugin.logoPath : null,
            MAX_CATALOG_LOGO_BYTES,
          ).pipe(Effect.map((logoDataUrl) => catalogPlugin(plugin.detail, logoDataUrl))),
        { concurrency: 16 },
      );
      const plugins = new Map(loadedPlugins.map((plugin) => [plugin.detail.id, plugin]));
      const catalog = {
        plugins: mergeCatalogListings(catalogPlugins),
        notices,
      } satisfies PluginMarketplaceCatalog;
      const now = yield* Clock.currentTimeMillis;
      const snapshot = { expiresAt: now + CATALOG_CACHE_TTL_MS, catalog, plugins, notices };
      yield* Ref.set(cachedSnapshot, snapshot);
      return snapshot;
    });

    const getSnapshot = Effect.fn("CodexPluginMarketplace.getSnapshot")(function* () {
      return yield* snapshotLock.withPermits(1)(
        Effect.gen(function* () {
          const cached = yield* Ref.get(cachedSnapshot);
          const now = yield* Clock.currentTimeMillis;
          return cached && cached.expiresAt > now ? cached : yield* refreshSnapshot();
        }),
      );
    });

    const invalidateSnapshot = snapshotLock.withPermits(1)(Ref.set(cachedSnapshot, null));

    const loadLogoDataUrl = Effect.fn("CodexPluginMarketplace.loadLogoDataUrl")(function* (
      logoPath: string | null,
      maxBytes = MAX_LOGO_BYTES,
    ) {
      if (!logoPath) return null;
      const extension = path.extname(logoPath).toLocaleLowerCase();
      const mimeType =
        extension === ".png"
          ? "image/png"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : extension === ".webp"
              ? "image/webp"
              : extension === ".svg"
                ? "image/svg+xml"
                : null;
      if (!mimeType) return null;
      const info = yield* fileSystem.stat(logoPath).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "File" || info.value.size > maxBytes)
        return null;
      const bytes = yield* fileSystem.readFile(logoPath).pipe(Effect.option);
      if (Option.isNone(bytes) || bytes.value.byteLength > maxBytes) return null;
      return `data:${mimeType};base64,${Buffer.from(bytes.value).toString("base64")}`;
    });

    const rememberLoadedPlugins = Effect.fn("CodexPluginMarketplace.rememberLoadedPlugins")(
      function* (loaded: ReadonlyArray<LoadedPlugin>) {
        if (loaded.length === 0) return;
        yield* snapshotLock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(cachedSnapshot);
            if (!current) return;
            const plugins = new Map(current.plugins);
            for (const plugin of loaded) plugins.set(plugin.detail.id, plugin);
            yield* Ref.set(cachedSnapshot, { ...current, plugins });
          }),
        );
      },
    );

    const loadSearchPlugins = Effect.fn("CodexPluginMarketplace.loadSearchPlugins")(function* (
      snapshot: CatalogSnapshot,
      query: string,
    ) {
      const records = yield* searchChatGptPublicPluginRecords(query);
      const existingIds = new Set(snapshot.plugins.keys());
      const novel = records.filter((record) => !existingIds.has(record.pluginId));
      if (novel.length === 0) return [];
      const loaded = (yield* Effect.forEach(novel, loadPlugin, { concurrency: 8 })).map(
        withInstallTarget,
      );
      yield* rememberLoadedPlugins(loaded);
      return yield* Effect.forEach(
        loaded,
        (plugin) =>
          loadLogoDataUrl(
            plugin.detail.installed ? plugin.logoPath : null,
            MAX_CATALOG_LOGO_BYTES,
          ).pipe(Effect.map((logoDataUrl) => catalogPlugin(plugin.detail, logoDataUrl))),
        { concurrency: 8 },
      );
    });

    const findPlugin = Effect.fn("CodexPluginMarketplace.findPlugin")(function* (pluginId: string) {
      const snapshot = yield* getSnapshot();
      const plugin = snapshot.plugins.get(pluginId);
      if (plugin) return plugin;
      const searchName = chatGptPublicPluginNameFromPublicId(pluginId);
      if (!searchName) return yield* new PluginMarketplaceNotFoundError({ pluginId });
      yield* loadSearchPlugins(snapshot, searchName);
      const resolved = (yield* getSnapshot()).plugins.get(pluginId);
      if (!resolved) return yield* new PluginMarketplaceNotFoundError({ pluginId });
      return resolved;
    });

    // Remote-only Codex plugins have no package on disk; their skills, apps, and MCP servers come
    // from the app-server on demand and are cached on the snapshot.
    const loadCodexRemoteDetail = Effect.fn("CodexPluginMarketplace.loadCodexRemoteDetail")(
      function* (plugin: LoadedPlugin): Effect.fn.Return<LoadedPlugin> {
        const runtime = options.codexPluginRuntime;
        const remote = plugin.record.codexRemote;
        if (
          !runtime?.read ||
          !remote ||
          plugin.record.harness !== "codex" ||
          plugin.record.pluginRoot !== null ||
          plugin.codexRemoteDetailLoaded
        ) {
          return plugin;
        }
        const read = yield* runtime.read(remote).pipe(Effect.option);
        if (Option.isNone(read)) return plugin;
        const inventory = read.value;
        const skills = inventory.skills
          .map((skill): PluginMarketplaceSkill => ({
            id: skill.name,
            name: displayNameFromId(skill.name),
            description: cleanText(skill.description ?? undefined, "Codex skill."),
            invocation: `$${plugin.record.name}:${skill.name}`,
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name));
        const mcpServers = inventory.mcpServerNames
          .map((name): PluginMarketplaceMcpServer => ({
            id: name,
            name: displayNameFromId(name),
            transport: "unknown",
            url: null,
            oauthResource: null,
            note: "Configuration supplied by the Codex catalog.",
            toolTimeoutSeconds: null,
            environmentVariables: [],
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name));
        const apps = inventory.apps
          .map((app): PluginMarketplaceApp => ({
            id: app.id,
            name: cleanText(app.name ?? undefined, displayNameFromId(app.id)),
            connectorId: app.id,
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name));
        const extensions =
          inventory.hookCount > 0
            ? [
                marketplaceExtension(
                  "hook",
                  "lifecycle-hooks",
                  "Plugin lifecycle hooks.",
                  undefined,
                ),
              ]
            : [];
        const contents = {
          ...plugin.detail.contents,
          skillCount: skills.length,
          mcpServerCount: mcpServers.length,
          appCount: apps.length,
          hookCount: extensions.length,
          hasHooks: extensions.length > 0,
        };
        const loaded: LoadedPlugin = {
          ...plugin,
          codexRemoteDetailLoaded: true,
          detail: {
            ...plugin.detail,
            description: cleanText(inventory.description ?? undefined, plugin.detail.description),
            skills,
            mcpServers,
            apps,
            extensions,
            contents,
            support: plugin.detail.support.map((entry) =>
              entry.harness === "codex"
                ? {
                    ...entry,
                    mcp: mcpServers.length > 0,
                    skills: skills.length > 0,
                    apps: apps.length > 0,
                  }
                : entry,
            ),
            installTargets: plugin.detail.installTargets.map((target) =>
              target.pluginId === plugin.detail.id ? { ...target, contents } : target,
            ),
          },
        };
        yield* rememberLoadedPlugins([loaded]);
        return loaded;
      },
    );

    const catalog = Effect.fn("CodexPluginMarketplace.catalog")(function* (query?: string) {
      const snapshot = yield* getSnapshot();
      const normalized = query?.trim() ?? "";
      if (normalized.length < CHATGPT_PUBLIC_PLUGIN_SEARCH_MIN_QUERY_LENGTH) {
        return snapshot.catalog;
      }
      const extras = yield* loadSearchPlugins(snapshot, normalized);
      if (extras.length === 0) return snapshot.catalog;
      return {
        plugins: mergeCatalogListings([...snapshot.catalog.plugins, ...extras]),
        notices: snapshot.notices,
      } satisfies PluginMarketplaceCatalog;
    });

    const detail = Effect.fn("CodexPluginMarketplace.detail")(function* (pluginId: string) {
      const plugin = yield* findPlugin(pluginId).pipe(Effect.flatMap(loadCodexRemoteDetail));
      const snapshot = yield* getSnapshot();
      const merged = mergeLoadedListings(listingSiblings(snapshot.plugins, plugin));
      const logoDataUrl = yield* loadLogoDataUrl(merged.logoPath);
      const loaded = yield* loadRemotePreview(merged).pipe(
        Effect.orElseSucceed(() => merged.detail),
      );
      return {
        ...loaded,
        installed: merged.detail.installed,
        enabled: merged.detail.enabled,
        support: merged.detail.support,
        contents: mergeListingContents([
          { contents: loaded.contents },
          ...listingSiblings(snapshot.plugins, plugin).map((sibling) => sibling.detail),
        ]),
        installTargets: merged.detail.installTargets.map((target) =>
          target.pluginId === loaded.id ? { ...target, contents: loaded.contents } : target,
        ),
        logoDataUrl,
      };
    });

    const logo = Effect.fn("CodexPluginMarketplace.logo")(function* (pluginId: string) {
      const plugin = yield* findPlugin(pluginId);
      return {
        dataUrl: yield* loadLogoDataUrl(plugin.logoPath),
      } satisfies PluginMarketplaceLogo;
    });

    const loadMcpAuthCandidates = Effect.fn("CodexPluginMarketplace.loadMcpAuthCandidates")(
      function* (pluginId: string) {
        const plugin = yield* findPlugin(pluginId);
        const snapshot = yield* getSnapshot();
        const merged = mergeLoadedListings(listingSiblings(snapshot.plugins, plugin));
        const candidates = yield* Effect.forEach(
          merged.detail.installTargets.filter(
            (target) => target.installed && target.contents.mcpServerCount > 0,
          ),
          (target) =>
            Effect.gen(function* () {
              const targetPlugin = snapshot.plugins.get(target.pluginId);
              if (!targetPlugin) return [];
              const detail = targetPlugin.record.pluginRoot
                ? targetPlugin.detail
                : yield* loadRemotePreview(targetPlugin).pipe(
                    Effect.orElseSucceed(() => targetPlugin.detail),
                  );
              return detail.mcpServers
                .filter((server) =>
                  target.harness === "cursor"
                    ? true
                    : server.transport === "http" && server.url !== null,
                )
                .map((server): McpAuthCandidate => ({
                  target,
                  packageName: detail.packageName,
                  server,
                }));
            }),
          { concurrency: 3 },
        );
        return candidates.flat();
      },
    );

    const runtimeStatuses = Effect.fn("CodexPluginMarketplace.runtimeStatuses")(function* (
      candidates: ReadonlyArray<McpAuthCandidate>,
    ) {
      const harnesses = [
        ...new Set(
          candidates
            .map((candidate) => candidate.target.harness)
            .filter(
              (harness): harness is McpOAuthRuntime.McpOAuthHarness =>
                harness === "codex" || harness === "claude" || harness === "cursor",
            ),
        ),
      ];
      const results = yield* Effect.forEach(
        harnesses,
        (
          harness,
        ): Effect.Effect<
          readonly [
            McpOAuthRuntime.McpOAuthHarness,
            Result.Result<
              ReadonlyArray<McpOAuthRuntime.McpOAuthServerStatus>,
              McpOAuthRuntime.McpOAuthRuntimeError
            > | null,
          ]
        > => {
          if (!options.mcpOAuthRuntime) return Effect.succeed([harness, null] as const);
          return options.mcpOAuthRuntime.status(harness).pipe(
            Effect.result,
            Effect.map((result) => [harness, result] as const),
          );
        },
        { concurrency: 3 },
      );
      return new Map(results);
    });

    const mcpAuth = Effect.fn("CodexPluginMarketplace.mcpAuth")(function* (pluginId: string) {
      const candidates = yield* loadMcpAuthCandidates(pluginId);
      const statusesByHarness = yield* runtimeStatuses(candidates);
      const connections = candidates.map((candidate): PluginMarketplaceMcpAuthConnection => {
        const harness = candidate.target.harness;
        if (harness === "cursor") {
          const result = statusesByHarness.get("cursor");
          const statuses = result && Result.isSuccess(result) ? result.success : [];
          const native = resolveNativeMcpStatus(
            "cursor",
            candidate.packageName,
            candidate.server,
            statuses,
          );
          return {
            harness,
            serverId: candidate.server.id,
            serverName: candidate.server.name,
            endpoint: candidate.server.url,
            status: "external",
            detail: native?.detail ?? "Authentication is managed by Cursor.",
            authorizationUrl: null,
            callbackRequired: false,
            canConnect: false,
            canDisconnect: false,
            marketplaceUrl: candidate.target.marketplaceUrl,
          };
        }
        if (harness !== "codex" && harness !== "claude") {
          return {
            harness,
            serverId: candidate.server.id,
            serverName: candidate.server.name,
            endpoint: candidate.server.url,
            status: "unsupported",
            detail: `${harness} does not expose MCP OAuth management yet.`,
            authorizationUrl: null,
            callbackRequired: false,
            canConnect: false,
            canDisconnect: false,
            marketplaceUrl: candidate.target.marketplaceUrl,
          };
        }
        const result = statusesByHarness.get(harness);
        if (!result || result === null || Result.isFailure(result)) {
          return {
            harness,
            serverId: candidate.server.id,
            serverName: candidate.server.name,
            endpoint: candidate.server.url,
            status: "unavailable",
            detail:
              result && Result.isFailure(result)
                ? result.failure.message
                : `${harness} MCP status is unavailable on this environment.`,
            authorizationUrl: null,
            callbackRequired: false,
            canConnect: false,
            canDisconnect: false,
            marketplaceUrl: candidate.target.marketplaceUrl,
          };
        }
        const native = resolveNativeMcpStatus(
          harness,
          candidate.packageName,
          candidate.server,
          result.success,
        );
        if (!native) {
          return {
            harness,
            serverId: candidate.server.id,
            serverName: candidate.server.name,
            endpoint: candidate.server.url,
            status: "unavailable",
            detail: `This MCP server has not appeared in ${harness} yet. Reload the provider after installation.`,
            authorizationUrl: null,
            callbackRequired: false,
            canConnect: false,
            canDisconnect: false,
            marketplaceUrl: candidate.target.marketplaceUrl,
          };
        }
        return {
          harness,
          serverId: candidate.server.id,
          serverName: candidate.server.name,
          endpoint: candidate.server.url,
          status: native.status,
          detail: native.detail,
          authorizationUrl: native.authorizationUrl,
          callbackRequired: native.authorizationUrl !== null && native.status === "connecting",
          canConnect: native.canConnect,
          canDisconnect: native.canDisconnect,
          marketplaceUrl: candidate.target.marketplaceUrl,
        };
      });
      return { pluginId, connections } satisfies PluginMarketplaceMcpAuthState;
    });

    const resolveMcpAuthTarget = Effect.fn("CodexPluginMarketplace.resolveMcpAuthTarget")(
      function* (pluginId: string, harness: PluginMarketplaceHarnessId, serverId: string) {
        if (harness !== "codex" && harness !== "claude" && harness !== "cursor") {
          return yield* new PluginMarketplaceOperationError({
            operation: "authenticate",
            pluginId,
            detail: `${harness} does not support managed MCP authentication.`,
          });
        }
        const candidates = yield* loadMcpAuthCandidates(pluginId);
        const candidate = candidates.find(
          (item) => item.target.harness === harness && item.server.id === serverId,
        );
        if (!candidate) {
          return yield* new PluginMarketplaceOperationError({
            operation: "authenticate",
            pluginId,
            detail: "This installed package does not expose that remote MCP server.",
          });
        }
        if (harness === "cursor") {
          return yield* new PluginMarketplaceOperationError({
            operation: "authenticate",
            pluginId,
            detail: "Cursor manages MCP authentication in its own Marketplace UI.",
          });
        }
        if (!options.mcpOAuthRuntime) {
          return yield* new PluginMarketplaceOperationError({
            operation: "authenticate",
            pluginId,
            detail: "MCP authentication is unavailable on this environment.",
          });
        }
        const statuses = yield* options.mcpOAuthRuntime.status(harness).pipe(
          Effect.mapError(
            (error) =>
              new PluginMarketplaceOperationError({
                operation: "authenticate",
                pluginId,
                detail: `${mcpHarnessLabel(harness)} could not report MCP authentication status for '${serverId}'.`,
                cause: error,
              }),
          ),
        );
        const native = resolveNativeMcpStatus(
          harness,
          candidate.packageName,
          candidate.server,
          statuses,
        );
        if (!native) {
          return yield* new PluginMarketplaceOperationError({
            operation: "authenticate",
            pluginId,
            detail: `This MCP server is not registered in ${harness} yet. Reload the provider after installation.`,
          });
        }
        return { candidate, native, harness } as const;
      },
    );

    const startMcpAuth = Effect.fn("CodexPluginMarketplace.startMcpAuth")(function* (
      pluginId: string,
      harness: PluginMarketplaceHarnessId,
      serverId: string,
    ) {
      const resolved = yield* resolveMcpAuthTarget(pluginId, harness, serverId);
      const started = yield* options
        .mcpOAuthRuntime!.start(resolved.harness, resolved.native.name)
        .pipe(
          Effect.mapError(
            (error) =>
              new PluginMarketplaceOperationError({
                operation: "authenticate",
                pluginId,
                detail: `${mcpHarnessLabel(resolved.harness)} could not start MCP authentication for '${serverId}'.`,
                cause: error,
              }),
          ),
        );
      return {
        pluginId,
        harness: resolved.harness,
        serverId,
        status: "connecting",
        authorizationUrl: started.authorizationUrl,
        callbackRequired: started.callbackRequired,
      } satisfies PluginMarketplaceMcpAuthStartResult;
    });

    const completeMcpAuth = Effect.fn("CodexPluginMarketplace.completeMcpAuth")(function* (
      pluginId: string,
      harness: PluginMarketplaceHarnessId,
      serverId: string,
      callbackUrl: string,
    ) {
      const resolved = yield* resolveMcpAuthTarget(pluginId, harness, serverId);
      yield* options
        .mcpOAuthRuntime!.complete(resolved.harness, resolved.native.name, callbackUrl)
        .pipe(
          Effect.mapError(
            (error) =>
              new PluginMarketplaceOperationError({
                operation: "authenticate",
                pluginId,
                detail: `${mcpHarnessLabel(resolved.harness)} could not complete MCP authentication for '${serverId}'.`,
                cause: error,
              }),
          ),
        );
      return {
        pluginId,
        harness: resolved.harness,
        serverId,
        status: "connecting",
      } satisfies PluginMarketplaceMcpAuthMutationResult;
    });

    const disconnectMcpAuth = Effect.fn("CodexPluginMarketplace.disconnectMcpAuth")(function* (
      pluginId: string,
      harness: PluginMarketplaceHarnessId,
      serverId: string,
    ) {
      const resolved = yield* resolveMcpAuthTarget(pluginId, harness, serverId);
      yield* options.mcpOAuthRuntime!.disconnect(resolved.harness, resolved.native.name).pipe(
        Effect.mapError(
          (error) =>
            new PluginMarketplaceOperationError({
              operation: "authenticate",
              pluginId,
              detail: `${mcpHarnessLabel(resolved.harness)} could not disconnect MCP authentication for '${serverId}'.`,
              cause: error,
            }),
        ),
      );
      return {
        pluginId,
        harness: resolved.harness,
        serverId,
        status: "not_connected",
      } satisfies PluginMarketplaceMcpAuthMutationResult;
    });

    const setup = Effect.fn("CodexPluginMarketplace.setup")(function* (
      pluginId: string,
      action: PluginMarketplaceSetupAction,
    ) {
      const requestedPlugin = yield* findPlugin(pluginId);
      if (
        requestedPlugin.record.harness !== "codex" ||
        (requestedPlugin.record.name !== "computer-use" &&
          requestedPlugin.detail.packageName !== "computer-use")
      ) {
        return yield* new PluginMarketplaceOperationError({
          operation: "setup",
          pluginId,
          detail: "This plugin does not provide a native permission setup flow.",
        });
      }
      if (platform !== "darwin") {
        return yield* new PluginMarketplaceOperationError({
          operation: "setup",
          pluginId,
          detail: "Computer Use permission setup is currently available only on macOS.",
        });
      }

      const snapshot = yield* getSnapshot();
      const codexPlugin = [...snapshot.plugins.values()].find(
        (candidate) =>
          candidate.record.harness === "codex" &&
          candidate.record.name === "computer-use" &&
          candidate.record.pluginRoot,
      );
      const codexHome = codexPlugin?.record.pluginRoot
        ? inferCodexHome(codexPlugin.record.pluginRoot)
        : null;
      const computerUseApp = codexHome
        ? path.join(codexHome, "computer-use", "Codex Computer Use.app")
        : null;
      const computerUseAppExists = computerUseApp
        ? yield* fileSystem.exists(computerUseApp).pipe(Effect.orElseSucceed(() => false))
        : false;
      if (!computerUseApp || !computerUseAppExists) {
        return yield* new PluginMarketplaceOperationError({
          operation: "setup",
          pluginId,
          detail: "The signed Codex Computer Use setup app could not be found.",
        });
      }

      const target =
        action === "permissions"
          ? computerUseApp
          : action === "accessibility"
            ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            : "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";
      const result = yield* processRunner
        .run({
          command: "/usr/bin/open",
          args: [target],
          cwd: marketplaceCwd,
          timeout: "30 seconds",
          maxOutputBytes: 64 * 1024,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PluginMarketplaceOperationError({
                operation: "setup",
                pluginId,
                detail: "macOS could not open the Computer Use permission setup.",
                cause,
              }),
          ),
        );
      if (result.code !== 0) {
        return yield* new PluginMarketplaceOperationError({
          operation: "setup",
          pluginId,
          detail: publicOperationDetail(result.code),
          ...(result.code === null ? {} : { exitCode: result.code }),
        });
      }
      return { pluginId, action, opened: true } satisfies PluginMarketplaceSetupResult;
    });

    const mutate = Effect.fn("CodexPluginMarketplace.mutate")(function* (
      operation: "install" | "remove",
      pluginId: string,
    ) {
      const plugin = yield* findPlugin(pluginId);
      const codexRemote =
        plugin.record.harness === "codex" && options.codexPluginRuntime !== undefined
          ? plugin.record.codexRemote
          : undefined;
      const usesCodexRuntime = codexRemote !== undefined;
      if (
        operation === "install" &&
        plugin.record.installed &&
        (!usesCodexRuntime || plugin.record.codexRuntimeInstalledId !== null)
      ) {
        if (plugin.record.harness !== "cursor" && options.onHarnessChanged) {
          yield* options.onHarnessChanged(plugin.record.harness);
        }
        return { pluginId, installed: true } satisfies PluginMarketplaceMutationResult;
      }
      if (operation === "remove" && !plugin.record.installed) {
        return { pluginId, installed: false } satisfies PluginMarketplaceMutationResult;
      }
      if (plugin.detail.installPolicy !== "AVAILABLE") {
        return yield* new PluginMarketplaceOperationError({
          operation,
          pluginId,
          detail: "This marketplace policy does not allow changing the plugin installation.",
        });
      }

      if (plugin.record.harness === "cursor") {
        return yield* new PluginMarketplaceOperationError({
          operation,
          pluginId,
          detail: "Cursor currently requires plugin changes through its Marketplace UI.",
        });
      }
      if (codexRemote && options.codexPluginRuntime) {
        const runtime = options.codexPluginRuntime;
        const invalidateCodex = Effect.gen(function* () {
          yield* invalidateSnapshot;
          if (options.onHarnessChanged) yield* options.onHarnessChanged("codex");
        });
        if (operation === "install") {
          yield* runtime
            .install(
              codexRemote.pluginName,
              codexRemote.remotePluginId
                ? {
                    remotePluginId: codexRemote.remotePluginId,
                    marketplaceName: codexRemote.marketplaceName,
                  }
                : undefined,
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PluginMarketplaceOperationError({
                    operation,
                    pluginId,
                    detail: `Codex could not install ${plugin.detail.name} from its runtime catalog.`,
                    cause,
                  }),
              ),
            );
        } else if (plugin.record.codexRuntimeInstalledId) {
          yield* runtime.remove(plugin.record.codexRuntimeInstalledId).pipe(
            Effect.mapError(
              (cause) =>
                new PluginMarketplaceOperationError({
                  operation,
                  pluginId,
                  detail: `Codex could not uninstall ${plugin.detail.name} from its runtime catalog.`,
                  cause,
                }),
            ),
          );
        }

        if (plugin.record.codexLegacyInstalled) {
          const codexCommand = yield* commandFor("codex", "codex");
          if (!codexCommand) {
            yield* invalidateCodex;
            return yield* new PluginMarketplaceOperationError({
              operation,
              pluginId,
              detail: "The configured Codex provider is unavailable.",
            });
          }
          const legacyRemoval = yield* processRunner
            .run({
              command: codexCommand.command,
              args: ["plugin", "remove", plugin.record.sourcePluginId, "--json"],
              cwd: marketplaceCwd,
              env: codexCommand.env,
              timeout: "60 seconds",
              maxOutputBytes: 1024 * 1024,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PluginMarketplaceOperationError({
                    operation,
                    pluginId,
                    detail: `Codex could not remove the local ${plugin.detail.name} package.`,
                    cause,
                  }),
              ),
              Effect.tapError(() => invalidateCodex),
            );
          if (legacyRemoval.code !== 0) {
            yield* invalidateCodex;
            return yield* new PluginMarketplaceOperationError({
              operation,
              pluginId,
              detail: publicOperationDetail(legacyRemoval.code),
              ...(legacyRemoval.code === null ? {} : { exitCode: legacyRemoval.code }),
            });
          }
        }

        yield* invalidateCodex;
        return {
          pluginId,
          installed: operation === "install",
        } satisfies PluginMarketplaceMutationResult;
      }
      const command = operation === "install" ? "add" : "remove";
      const providerCommand = yield* commandFor(plugin.record.harness, plugin.record.harness);
      if (!providerCommand) {
        return yield* new PluginMarketplaceOperationError({
          operation,
          pluginId,
          detail: `The configured ${plugin.record.harness === "codex" ? "Codex" : "Claude Code"} provider is unavailable.`,
        });
      }
      const invocation =
        plugin.record.harness === "codex"
          ? {
              command: providerCommand.command,
              args: ["plugin", command, plugin.record.sourcePluginId, "--json"],
              env: providerCommand.env,
            }
          : {
              command: providerCommand.command,
              args: [
                "plugin",
                operation === "install" ? "install" : "uninstall",
                plugin.record.sourcePluginId,
                "--scope",
                "user",
                "--yes",
              ],
              env: providerCommand.env,
            };
      const result = yield* processRunner
        .run({
          ...invocation,
          cwd: marketplaceCwd,
          timeout: "60 seconds",
          maxOutputBytes: 1024 * 1024,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PluginMarketplaceOperationError({
                operation,
                pluginId,
                detail: `${plugin.record.harness === "codex" ? "Codex" : "Claude Code"} could not start the plugin operation.`,
                cause,
              }),
          ),
        );
      if (result.code !== 0) {
        return yield* new PluginMarketplaceOperationError({
          operation,
          pluginId,
          detail: publicOperationDetail(result.code),
          ...(result.code === null ? {} : { exitCode: result.code }),
        });
      }
      yield* invalidateSnapshot;
      if (options.onHarnessChanged) {
        yield* options.onHarnessChanged(plugin.record.harness);
      }
      return {
        pluginId,
        installed: operation === "install",
      } satisfies PluginMarketplaceMutationResult;
    });

    return CodexPluginMarketplace.of({
      catalog,
      detail,
      logo,
      mcpAuth,
      startMcpAuth,
      completeMcpAuth,
      disconnectMcpAuth,
      setup,
      install: (pluginId) => mutate("install", pluginId),
      remove: (pluginId) => mutate("remove", pluginId),
    });
  });

const makeCodexPluginRuntime = (
  options: {
    readonly command?: { readonly command: string; readonly env: NodeJS.ProcessEnv };
    readonly resolveCommand?: () => Effect.Effect<
      { readonly command: string; readonly env: NodeJS.ProcessEnv } | undefined
    >;
    readonly cwd?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cwd = options.cwd ?? (yield* HostProcessWorkingDirectory);
    const hostEnvironment = yield* HostProcessEnvironment;
    const withClient = <A, E>(
      operation: CodexPluginRuntimeError["operation"],
      pluginRef: string | undefined,
      use: (client: CodexClient.CodexAppServerClient["Service"]) => Effect.Effect<A, E>,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const command = options.resolveCommand
            ? yield* options.resolveCommand()
            : (options.command ?? { command: "codex", env: hostEnvironment });
          if (!command) {
            return yield* new CodexPluginProviderUnavailableError({
              operation,
              ...(pluginRef === undefined ? {} : { pluginRef }),
            });
          }
          const spawnCommand = yield* resolveSpawnCommand(command.command, ["app-server"], {
            env: command.env,
            extendEnv: true,
          });
          const child = yield* spawner.spawn(
            ChildProcess.make(spawnCommand.command, spawnCommand.args, {
              cwd,
              env: command.env,
              extendEnv: true,
              shell: spawnCommand.shell,
              forceKillAfter: "2 seconds",
            }),
          );
          const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
          const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
            Effect.provide(clientContext),
          );
          yield* client.request("initialize", {
            clientInfo: {
              name: "t3code_plugin_marketplace",
              title: `${resolveAppDisplayName()} Plugin Marketplace`,
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          });
          yield* client.notify("initialized", undefined);
          return yield* use(client);
        }),
      );

    // Raw requests are decoded with the lenient schemas above rather than the generated ones, so a
    // Codex release that adds fields or enum values cannot break the marketplace.
    const readCatalog = (
      client: CodexClient.CodexAppServerClient["Service"],
      operation: CodexPluginRuntimeError["operation"],
    ) =>
      Effect.gen(function* () {
        const [listResponse, installedResponse] = yield* Effect.all(
          [
            client.raw.request("plugin/list", { cwds: [cwd] }),
            client.raw.request("plugin/installed", { cwds: [cwd] }),
          ],
          { concurrency: 2 },
        );
        const catalog = decodeCodexRuntimeCatalog(listResponse, installedResponse);
        if (Option.isNone(catalog)) {
          return yield* new CodexPluginOperationFailedError({
            operation,
            cause: new Error("Codex returned an unreadable plugin catalog."),
          });
        }
        return catalog.value;
      });

    return CodexPluginRuntime.of({
      installed: () =>
        withClient("installed", undefined, (client) =>
          Effect.gen(function* () {
            const response = yield* client.raw.request("plugin/installed", { cwds: [cwd] });
            const catalog = decodeCodexRuntimeCatalog(undefined, response);
            if (Option.isNone(catalog)) {
              return yield* new CodexPluginOperationFailedError({
                operation: "installed",
                cause: new Error("Codex returned an unreadable installed plugin inventory."),
              });
            }
            return catalog.value.plugins;
          }),
        ).pipe(
          Effect.mapError((cause) =>
            isCodexPluginRuntimeError(cause)
              ? cause
              : new CodexPluginOperationFailedError({ operation: "installed", cause }),
          ),
        ),
      list: () =>
        withClient("list", undefined, (client) => readCatalog(client, "list")).pipe(
          Effect.mapError((cause) =>
            isCodexPluginRuntimeError(cause)
              ? cause
              : new CodexPluginOperationFailedError({ operation: "list", cause }),
          ),
        ),
      read: (target) =>
        withClient("read", target.pluginName, (client) =>
          Effect.gen(function* () {
            const response = yield* client.raw.request("plugin/read", {
              pluginName: target.pluginName,
              remoteMarketplaceName: target.marketplaceName,
            });
            const detail = decodeCodexRuntimePluginDetail(response);
            if (Option.isNone(detail)) {
              return yield* new CodexPluginNotFoundError({
                operation: "read",
                pluginRef: target.pluginName,
              });
            }
            return detail.value;
          }),
        ).pipe(
          Effect.mapError((cause) =>
            isCodexPluginRuntimeError(cause)
              ? cause
              : new CodexPluginOperationFailedError({
                  operation: "read",
                  pluginRef: target.pluginName,
                  cause,
                }),
          ),
        ),
      install: (pluginName, remote) =>
        withClient("install", pluginName, (client) =>
          Effect.gen(function* () {
            const candidate =
              remote ??
              (yield* readCatalog(client, "install")).plugins.find(
                (plugin) =>
                  plugin.name.toLocaleLowerCase() === pluginName.toLocaleLowerCase() &&
                  plugin.marketplaceName === CODEX_CURATED_REMOTE_MARKETPLACE &&
                  plugin.remotePluginId,
              );
            if (!candidate?.remotePluginId) {
              return yield* new CodexPluginNotFoundError({
                operation: "install",
                pluginRef: pluginName,
              });
            }
            yield* client.raw.request("plugin/install", {
              pluginName: candidate.remotePluginId,
              remoteMarketplaceName: candidate.marketplaceName,
            });
          }),
        ).pipe(
          Effect.mapError((error) =>
            isCodexPluginRuntimeError(error)
              ? error
              : new CodexPluginOperationFailedError({
                  operation: "install",
                  pluginRef: pluginName,
                  cause: error,
                }),
          ),
        ),
      remove: (pluginId) =>
        withClient("remove", pluginId, (client) =>
          Effect.gen(function* () {
            yield* client.raw.request("plugin/uninstall", { pluginId });
            const installed = yield* client.raw.request("plugin/installed", { cwds: [cwd] });
            const remaining = Option.getOrElse(
              decodeCodexRuntimeCatalog(undefined, installed),
              () => ({ plugins: [] }),
            ).plugins.find((plugin) => plugin.id === pluginId && plugin.installed);
            if (remaining) {
              return yield* new CodexPluginStillInstalledError({
                operation: "remove",
                pluginRef: pluginId,
              });
            }
          }),
        ).pipe(
          Effect.mapError((cause) =>
            isCodexPluginRuntimeError(cause)
              ? cause
              : new CodexPluginOperationFailedError({
                  operation: "remove",
                  pluginRef: pluginId,
                  cause,
                }),
          ),
        ),
    });
  });

const makePluginProviderCommands = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcessEnvironment;

  const resolve = Effect.fn("PluginProviderCommands.resolve")(function* (
    harness: McpOAuthRuntime.McpOAuthHarness,
  ): Effect.fn.Return<PluginProviderCommand | undefined> {
    const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
    const driver = harness === "claude" ? "claudeAgent" : harness;
    const matches = Object.values(deriveProviderInstanceConfigMap(settings)).filter(
      (instance) => instance.enabled !== false && instance.driver === driver,
    );
    if (matches.length !== 1) return undefined;
    const instance = matches[0]!;
    const environment = mergeProviderInstanceEnvironment(
      instance.environment ?? [],
      hostEnvironment,
    );

    if (harness === "codex") {
      const config = decodeCodexSettingsOption(instance.config ?? {});
      if (Option.isNone(config)) return undefined;
      const layout = yield* resolveCodexHomeLayout(config.value).pipe(
        Effect.provideService(Path.Path, path),
      );
      return {
        command: config.value.binaryPath,
        env: {
          ...environment,
          ...(layout.effectiveHomePath ? { CODEX_HOME: layout.effectiveHomePath } : {}),
        },
      };
    }
    if (harness === "claude") {
      const config = decodeClaudeSettingsOption(instance.config ?? {});
      if (Option.isNone(config)) return undefined;
      return {
        command: config.value.binaryPath,
        env: yield* makeClaudeEnvironment(config.value, environment).pipe(
          Effect.provideService(Path.Path, path),
        ),
      };
    }
    const config = decodeCursorSettingsOption(instance.config ?? {});
    return Option.isSome(config)
      ? { command: config.value.binaryPath, env: environment }
      : undefined;
  });

  return PluginProviderCommands.of({ resolve });
});

export const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const providerCommands = yield* PluginProviderCommands;
  const codexPluginRuntime = yield* CodexPluginRuntime;
  const mcpOAuthRuntime = yield* McpOAuthRuntime.McpOAuthRuntime;

  return yield* makeWithOptions({
    codexPluginRuntime,
    mcpOAuthRuntime,
    resolveCommand: providerCommands.resolve,
    cwd: serverConfig.cwd,
  });
});

const providerCommandsLayer = Layer.effect(PluginProviderCommands, makePluginProviderCommands);

const runtimeLayer = Layer.merge(
  Layer.effect(
    CodexPluginRuntime,
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const providerCommands = yield* PluginProviderCommands;
      return yield* makeCodexPluginRuntime({
        cwd: serverConfig.cwd,
        resolveCommand: () => providerCommands.resolve("codex"),
      });
    }),
  ),
  McpOAuthRuntime.layer(
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const providerCommands = yield* PluginProviderCommands;
      return {
        cwd: serverConfig.cwd,
        resolveCommand: providerCommands.resolve,
      } satisfies McpOAuthRuntime.McpOAuthRuntimeOptions;
    }),
  ),
).pipe(Layer.provide(providerCommandsLayer));

export const layer = Layer.effect(CodexPluginMarketplace, make).pipe(
  Layer.provide(Layer.merge(runtimeLayer, providerCommandsLayer)),
  Layer.provide(ProcessRunner.layer),
);
