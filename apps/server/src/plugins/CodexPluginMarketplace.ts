import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as CodexClient from "effect-codex-app-server/client";

import {
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
  type PluginMarketplacePlugin,
  type PluginMarketplaceSetupAction,
  type PluginMarketplaceSetupResult,
  type PluginMarketplaceSkill,
  type PluginMarketplaceHarnessId,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { fromYaml } from "@t3tools/shared/schemaYaml";

import * as ProcessRunner from "../processRunner.ts";
import {
  makeMcpOAuthRuntime,
  type McpOAuthHarness,
  type McpOAuthRuntime,
  type McpOAuthServerStatus,
} from "./McpOAuthRuntime.ts";

const CATALOG_CACHE_TTL_MS = 30_000;
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_CATALOG_LOGO_BYTES = 48 * 1024;
const MAX_OPERATION_ERROR_LENGTH = 500;
const MAX_REMOTE_DESCRIPTION_FILES = 32;
const MAX_REMOTE_TREE_ENTRIES = 20_000;

const CodexPluginSource = Schema.Struct({
  source: Schema.String,
  path: Schema.String,
});

const CodexPluginMarketplaceSource = Schema.Struct({
  sourceType: Schema.String,
  source: Schema.String,
});

const CodexPluginRecord = Schema.Struct({
  pluginId: Schema.String,
  name: Schema.String,
  marketplaceName: Schema.String,
  version: Schema.String,
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
  source: CodexPluginSource,
  marketplaceSource: Schema.optional(CodexPluginMarketplaceSource),
  installPolicy: Schema.String,
  authPolicy: Schema.String,
});
type CodexPluginRecord = typeof CodexPluginRecord.Type;

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
  installed: Schema.Array(CodexPluginRecord),
  available: Schema.Array(CodexPluginRecord),
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
  readonly version: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly pluginRoot: string | null;
  readonly manifestDirectory: ".codex-plugin" | ".claude-plugin" | ".cursor-plugin";
  readonly marketplaceSourceType: "local" | "git" | "unknown";
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
  readonly directExtensions: ReadonlyArray<PluginMarketplaceExtension>;
  readonly remotePreviewSource: RemotePluginPreviewSource | null;
  readonly hasHooks: boolean;
  readonly codexLegacyInstalled?: boolean;
  readonly codexRuntimeInstalledId?: string | null;
}

export interface CodexRuntimePlugin {
  readonly id: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly remotePluginId: string | null;
  readonly installed: boolean;
  readonly enabled: boolean;
}

export class CodexPluginRuntimeError extends Schema.TaggedErrorClass<CodexPluginRuntimeError>()(
  "CodexPluginRuntimeError",
  {
    operation: Schema.Literals(["installed", "install", "remove"]),
    detail: Schema.String,
  },
) {}
const isCodexPluginRuntimeError = Schema.is(CodexPluginRuntimeError);

export interface CodexPluginRuntime {
  readonly installed: () => Effect.Effect<
    ReadonlyArray<CodexRuntimePlugin>,
    CodexPluginRuntimeError
  >;
  readonly install: (pluginName: string) => Effect.Effect<void, CodexPluginRuntimeError>;
  readonly remove: (pluginId: string) => Effect.Effect<void, CodexPluginRuntimeError>;
}

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
}

interface CatalogSnapshot {
  readonly expiresAt: number;
  readonly catalog: PluginMarketplaceCatalog;
  readonly plugins: ReadonlyMap<string, LoadedPlugin>;
}

interface McpAuthCandidate {
  readonly target: PluginMarketplaceInstallTarget;
  readonly packageName: string;
  readonly server: PluginMarketplaceMcpServer;
}

export class CodexPluginMarketplace extends Context.Service<
  CodexPluginMarketplace,
  {
    readonly catalog: () => Effect.Effect<
      PluginMarketplaceCatalog,
      PluginMarketplaceUnavailableError
    >;
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
  harness: McpOAuthHarness,
  packageName: string,
  server: PluginMarketplaceMcpServer,
  statuses: ReadonlyArray<McpOAuthServerStatus>,
): McpOAuthServerStatus | null {
  const serverId = server.id.toLocaleLowerCase();
  const names = new Set([
    serverId,
    server.name.toLocaleLowerCase(),
    ...(harness === "claude" ? [`plugin:${packageName.toLocaleLowerCase()}:${serverId}`] : []),
  ]);
  const endpoint = normalizedMcpEndpoint(server.url);
  return (
    statuses.find((status) => names.has(status.name.toLocaleLowerCase())) ??
    statuses.find(
      (status) => harness === "claude" && status.name.toLocaleLowerCase().endsWith(`:${serverId}`),
    ) ??
    statuses.find(
      (status) => endpoint !== null && normalizedMcpEndpoint(status.url) === endpoint,
    ) ??
    null
  );
}

function manifestDeveloper(manifest: PluginManifest, fallback = "Unknown"): string {
  const interfaceDeveloper = manifest.interface?.developerName?.trim();
  if (interfaceDeveloper) return interfaceDeveloper;
  if (typeof manifest.author === "string") return cleanText(manifest.author, fallback);
  return cleanText(manifest.author?.name, fallback);
}

function safePluginPath(path: Path.Path, pluginRoot: string, relativePath: string): string | null {
  if (!relativePath.startsWith("./")) return null;
  const root = path.resolve(pluginRoot);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative === ".") return resolved;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
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
    return value.split(/[?#]/u, 1)[0] ?? null;
  }
}

function publicOperationDetail(stderr: string, code: number | null): string {
  const detail = stderr
    // eslint-disable-next-line no-control-regex -- Codex stderr can include ANSI color sequences.
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const fallback = code === null ? "Codex did not report an exit status." : `Codex exited ${code}.`;
  return (detail || fallback).slice(0, MAX_OPERATION_ERROR_LENGTH);
}

function codexMarketplaceSourceType(record: CodexPluginRecord): "local" | "git" | "unknown" {
  const sourceType = record.marketplaceSource?.sourceType ?? record.source.source;
  if (sourceType === "local" || sourceType === "git") return sourceType;
  return "unknown";
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
  return `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/${encodeURIComponent(source.revision)}/${pathParts}`;
}

function remoteBrowseUrl(source: RemotePluginPreviewSource, relativePath: string): string {
  const pathParts = [source.subdirectory, relativePath]
    .filter(Boolean)
    .join("/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${source.repositoryUrl}/blob/${encodeURIComponent(source.revision)}/${pathParts}`;
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
    marketplaceSourceType: detail.marketplaceSourceType,
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

export interface PluginMarketplaceOptions {
  readonly readCursorMarketplaceHtml?: () => Effect.Effect<
    string,
    PluginMarketplaceUnavailableError
  >;
  readonly readRemoteText?: (url: string) => Effect.Effect<string | null>;
  readonly platform?: NodeJS.Platform;
  readonly codexPluginRuntime?: CodexPluginRuntime;
  readonly mcpOAuthRuntime?: McpOAuthRuntime;
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
    const platform = options.platform ?? (yield* HostProcessPlatform);

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

    const loadSkills = Effect.fn("CodexPluginMarketplace.loadSkills")(function* (
      record: PluginSourceRecord,
      manifest: PluginManifest,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceSkill>> {
      if (!record.pluginRoot) return record.directSkills;
      const skillsPath = typeof manifest.skills === "string" ? manifest.skills : "./skills";
      const skillsRoot = safePluginPath(
        path,
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
            const markdown = yield* fileSystem
              .readFileString(path.join(skillsRoot, entry, "SKILL.md"))
              .pipe(Effect.option);
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
      const mcpPath = safePluginPath(
        path,
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

      return Object.entries(decoded.value)
        .map(([id, server]) => {
          const environmentVariables = [
            ...(server.env_vars ?? []),
            ...(server.bearer_token_env_var ? [server.bearer_token_env_var] : []),
            ...Object.keys(server.env ?? {}),
          ].filter(
            (name, index, values) => name.trim().length > 0 && values.indexOf(name) === index,
          );
          const transport =
            server.type === "http" || server.url ? "http" : server.command ? "stdio" : "unknown";
          return {
            id,
            name: displayNameFromId(id),
            transport,
            url: sanitizeRemoteUrl(server.url),
            command: server.command ?? null,
            arguments: server.args ?? [],
            workingDirectory: server.cwd ?? null,
            oauthResource: sanitizeRemoteUrl(server.oauth_resource),
            note: server.note ?? null,
            toolTimeoutSeconds: server.tool_timeout_sec ?? null,
            environmentVariables,
          } satisfies PluginMarketplaceMcpServer;
        })
        .toSorted((left, right) => left.name.localeCompare(right.name));
    });

    const loadApps = Effect.fn("CodexPluginMarketplace.loadApps")(function* (
      record: PluginSourceRecord,
      manifest: PluginManifest,
    ): Effect.fn.Return<ReadonlyArray<PluginMarketplaceApp>> {
      if (!record.pluginRoot) return [];
      const configuredPath = typeof manifest.apps === "string" ? manifest.apps : "./.app.json";
      const appsPath = safePluginPath(
        path,
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
      const root = path.join(record.pluginRoot, directory);
      const entries = yield* fileSystem.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
      const markdownFiles = entries.filter((entry) => entry.toLocaleLowerCase().endsWith(".md"));
      return yield* Effect.forEach(
        markdownFiles,
        (entry) =>
          Effect.gen(function* () {
            const markdown = yield* fileSystem.readFileString(path.join(root, entry));
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
          extensions.flatMap((extension) => (Option.isSome(extension) ? [extension.value] : [])),
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
      const candidates = [
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
      ].map((candidate) => path.join(pluginRoot, candidate));
      const matches = yield* Effect.forEach(
        candidates,
        (candidate) => fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false)),
        { concurrency: 10 },
      );
      return candidates.find((_, index) => matches[index] === true) ?? null;
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
      const body = yield* response.value.text.pipe(Effect.option);
      if (Option.isNone(body) || Buffer.byteLength(body.value) > maxBytes) return null;
      return body.value;
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
        return Object.entries(decoded.value)
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
                server.type === "http" || server.url
                  ? "http"
                  : server.command
                    ? "stdio"
                    : "unknown",
              url: sanitizeRemoteUrl(server.url),
              command: server.command ?? null,
              arguments: server.args ?? [],
              workingDirectory: server.cwd ?? null,
              oauthResource: sanitizeRemoteUrl(server.oauth_resource),
              note: server.note ?? null,
              toolTimeoutSeconds: server.tool_timeout_sec ?? null,
              environmentVariables,
            } satisfies PluginMarketplaceMcpServer;
          })
          .toSorted((left, right) => left.name.localeCompare(right.name));
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
      const source = plugin.record.remotePreviewSource;
      if (!source || (!httpClient && !options.readRemoteText)) return plugin.detail;
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
        ? path.join(record.pluginRoot, record.manifestDirectory, "plugin.json")
        : null;
      const manifest = manifestPath
        ? yield* readJsonFile(manifestPath, PluginManifest).pipe(
            Effect.orElseSucceed(
              (): PluginManifest => ({
                name: record.name,
                version: record.version,
                description: record.fallbackDescription,
              }),
            ),
          )
        : ({
            name: record.name,
            version: record.version,
            description: record.fallbackDescription,
          } satisfies PluginManifest);
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
          ? safePluginPath(
              path,
              record.pluginRoot,
              logoRelativePath.startsWith("./") ? logoRelativePath : `./${logoRelativePath}`,
            )
          : null;
      const logoPath =
        configuredLogoPath ??
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
          marketplaceSourceType: record.marketplaceSourceType,
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
          marketplaceUrl: sanitizeRemoteUrl(record.marketplaceUrl ?? undefined),
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

      const configuredHome = process.env.CODEX_HOME?.trim();
      if (configuredHome) return configuredHome;
      const userHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
      return userHome ? path.join(userHome, ".codex") : null;
    };

    const readCodexPluginRecords = Effect.fn("CodexPluginMarketplace.readCodexPluginRecords")(
      function* () {
        const [result, runtimeResult] = yield* Effect.all(
          [
            processRunner.run({
              command: "codex",
              args: ["plugin", "list", "--available", "--json"],
              timeout: "30 seconds",
              maxOutputBytes: 8 * 1024 * 1024,
            }),
            options.codexPluginRuntime
              ? options.codexPluginRuntime.installed().pipe(Effect.result)
              : Effect.succeed(null),
          ],
          { concurrency: 2 },
        ).pipe(
          Effect.mapError(
            () => new PluginMarketplaceUnavailableError({ reason: "codex_unavailable" }),
          ),
        );
        if (result.code !== 0 || result.stdoutInvalidUtf8 || result.stdoutTruncated) {
          return yield* new PluginMarketplaceUnavailableError({ reason: "codex_unavailable" });
        }
        const decoded = yield* decodeCodexPluginListJson(result.stdout).pipe(
          Effect.mapError(
            () => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid" }),
          ),
        );
        const runtimeInventoryKnown = runtimeResult !== null && Result.isSuccess(runtimeResult);
        const runtimeByName = new Map(
          runtimeInventoryKnown
            ? runtimeResult.success
                .filter(
                  (plugin) =>
                    plugin.marketplaceName === "openai-curated-remote" && plugin.installed,
                )
                .map((plugin) => [plugin.name.toLocaleLowerCase(), plugin] as const)
            : [],
        );
        return [...decoded.installed, ...decoded.available].map((record): PluginSourceRecord => {
          const usesRuntimeInventory =
            record.marketplaceName === "openai-curated" && runtimeInventoryKnown;
          const runtimePlugin = usesRuntimeInventory
            ? runtimeByName.get(record.name.toLocaleLowerCase())
            : undefined;
          return {
            pluginId: publicPluginId("codex", record.pluginId),
            sourcePluginId: record.pluginId,
            harness: "codex",
            name: record.name,
            marketplaceName: record.marketplaceName,
            version: record.version,
            installed: usesRuntimeInventory ? runtimePlugin?.installed === true : record.installed,
            enabled: usesRuntimeInventory ? runtimePlugin?.enabled === true : record.enabled,
            pluginRoot: record.source.path,
            manifestDirectory: ".codex-plugin",
            marketplaceSourceType: codexMarketplaceSourceType(record),
            installPolicy: record.installPolicy,
            authPolicy: record.authPolicy,
            fallbackDescription: "Codex plugin",
            fallbackDisplayName: displayNameFromId(record.name),
            fallbackDeveloper: "Unknown",
            fallbackCategory: "Other",
            fallbackHomepage: null,
            fallbackRepository: null,
            marketplaceUrl: null,
            externalLogoUrl: null,
            directSkills: [],
            directMcpServers: [],
            directExtensions: [],
            remotePreviewSource: null,
            hasHooks: false,
            ...(usesRuntimeInventory
              ? {
                  codexLegacyInstalled: record.installed,
                  codexRuntimeInstalledId: runtimePlugin?.id ?? null,
                }
              : {}),
          };
        });
      },
    );

    const readClaudePluginRecords = Effect.fn("CodexPluginMarketplace.readClaudePluginRecords")(
      function* () {
        const [pluginsResult, marketplacesResult] = yield* Effect.all(
          [
            processRunner.run({
              command: "claude",
              args: ["plugin", "list", "--available", "--json"],
              timeout: "30 seconds",
              maxOutputBytes: 8 * 1024 * 1024,
            }),
            processRunner.run({
              command: "claude",
              args: ["plugin", "marketplace", "list", "--json"],
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
          });
        }
        const pluginList = yield* decodeClaudePluginListJson(pluginsResult.stdout).pipe(
          Effect.mapError(
            () => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid" }),
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
          const manifest = yield* readJsonFile(
            path.join(marketplace.installLocation, ".claude-plugin", "marketplace.json"),
            MarketplaceManifest,
          ).pipe(Effect.option);
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

        return [...available.values()].map((plugin): PluginSourceRecord => {
          const installedPlugin = installed.get(plugin.pluginId);
          const metadata = marketplaceMetadata.get(plugin.pluginId);
          const marketplaceRoot = marketplaceRoots.get(plugin.marketplaceName);
          const localSource = typeof plugin.source === "string" ? plugin.source : null;
          const marketplacePath =
            marketplaceRoot && localSource?.startsWith("./")
              ? safePluginPath(path, marketplaceRoot, localSource)
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
            directExtensions: [],
            remotePreviewSource: previewSource,
            hasHooks: false,
          };
        });
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
                  () =>
                    new PluginMarketplaceUnavailableError({ reason: "marketplaces_unavailable" }),
                ),
              );
              const body = yield* response.text.pipe(
                Effect.mapError(
                  () =>
                    new PluginMarketplaceUnavailableError({ reason: "marketplaces_unavailable" }),
                ),
              );
              if (body.length > 8 * 1024 * 1024) {
                return yield* new PluginMarketplaceUnavailableError({ reason: "catalog_invalid" });
              }
              return body;
            });
        const parsed = yield* Effect.try({
          try: () => parseCursorMarketplaceHtml(html),
          catch: () => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid" }),
        });
        const plugins = yield* decodeCursorMarketplacePlugins(parsed).pipe(
          Effect.mapError(
            () => new PluginMarketplaceUnavailableError({ reason: "catalog_invalid" }),
          ),
        );
        const home = process.env.HOME ?? process.env.USERPROFILE;
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
              const skills = (plugin.skills ?? []).map(
                (skill): PluginMarketplaceSkill => ({
                  id: skill.name,
                  name: displayNameFromId(skill.name),
                  description: cleanText(skill.description, "Cursor skill"),
                  invocation: skill.name,
                }),
              );
              const mcpServers = (plugin.mcpServers ?? []).map(
                (server): PluginMarketplaceMcpServer => ({
                  id: server.name,
                  name: displayNameFromId(server.name),
                  transport: "unknown",
                  url: null,
                  command: null,
                  arguments: [],
                  workingDirectory: null,
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
                directExtensions: extensions,
                remotePreviewSource: null,
                hasHooks: (plugin.hooks?.length ?? 0) > 0,
              };
            }),
          { concurrency: 32 },
        );
      },
    );

    const refreshSnapshot = Effect.fn("CodexPluginMarketplace.refreshSnapshot")(function* () {
      const sourceResults = yield* Effect.all(
        [
          readCodexPluginRecords().pipe(Effect.result),
          readClaudePluginRecords().pipe(Effect.result),
          readCursorPluginRecords().pipe(Effect.result),
        ],
        { concurrency: 3 },
      );
      const sourceRecords = sourceResults.flatMap((result) =>
        Result.isSuccess(result) ? [...result.success] : [],
      );
      if (sourceRecords.length === 0) {
        return yield* new PluginMarketplaceUnavailableError({ reason: "marketplaces_unavailable" });
      }
      const sourcePlugins = yield* Effect.forEach(sourceRecords, loadPlugin, { concurrency: 16 });
      const supportByPackage = new Map<
        string,
        Map<PluginMarketplaceHarnessId, PluginMarketplaceDetail["support"][number]>
      >();
      const installTargetsByPackage = new Map<string, Array<PluginMarketplaceInstallTarget>>();
      for (const plugin of sourcePlugins) {
        const key = plugin.detail.packageName.toLocaleLowerCase();
        const supportByHarness = supportByPackage.get(key) ?? new Map();
        for (const support of plugin.detail.support) {
          const current = supportByHarness.get(support.harness);
          supportByHarness.set(support.harness, {
            harness: support.harness,
            mcp: current?.mcp === true || support.mcp,
            skills: current?.skills === true || support.skills,
            apps: current?.apps === true || support.apps,
          });
        }
        supportByPackage.set(key, supportByHarness);
        const installTargets = installTargetsByPackage.get(key) ?? [];
        installTargets.push({
          pluginId: plugin.detail.id,
          harness: plugin.detail.sourceHarness,
          marketplaceName: plugin.detail.marketplaceName,
          version: plugin.detail.version,
          installed: plugin.record.installed,
          enabled: plugin.record.enabled,
          installPolicy: plugin.detail.installPolicy,
          marketplaceUrl: plugin.detail.marketplaceUrl,
          contents: plugin.detail.contents,
        });
        installTargetsByPackage.set(key, installTargets);
      }
      const loadedPlugins = sourcePlugins.map((plugin) => ({
        ...plugin,
        detail: {
          ...plugin.detail,
          support: [
            ...(supportByPackage.get(plugin.detail.packageName.toLocaleLowerCase())?.values() ??
              []),
          ],
          installTargets: (
            installTargetsByPackage.get(plugin.detail.packageName.toLocaleLowerCase()) ?? [
              {
                pluginId: plugin.detail.id,
                harness: plugin.detail.sourceHarness,
                marketplaceName: plugin.detail.marketplaceName,
                version: plugin.detail.version,
                installed: plugin.record.installed,
                enabled: plugin.record.enabled,
                installPolicy: plugin.detail.installPolicy,
                marketplaceUrl: plugin.detail.marketplaceUrl,
                contents: plugin.detail.contents,
              },
            ]
          ).toSorted(
            (left, right) =>
              ["codex", "claude", "cursor", "grok", "opencode"].indexOf(left.harness) -
              ["codex", "claude", "cursor", "grok", "opencode"].indexOf(right.harness),
          ),
        },
      }));
      const representativeByPackage = new Map<string, LoadedPlugin>();
      for (const plugin of loadedPlugins) {
        const key = plugin.detail.packageName.toLocaleLowerCase();
        const current = representativeByPackage.get(key);
        if (!current) {
          representativeByPackage.set(key, plugin);
          continue;
        }
        const score = (candidate: LoadedPlugin) =>
          Number(candidate.record.installed) * 10_000 +
          Number(candidate.logoPath !== null || candidate.detail.logoUrl !== null) * 1_000 +
          (candidate.detail.contents.skillCount +
            candidate.detail.contents.mcpServerCount +
            candidate.detail.contents.appCount +
            candidate.detail.contents.commandCount +
            candidate.detail.contents.agentCount +
            candidate.detail.contents.ruleCount) *
            100 +
          Number(candidate.detail.contents.hasHooks) * 50 +
          ({ codex: 3, claude: 2, cursor: 1 } as const)[candidate.record.harness];
        if (score(plugin) > score(current)) representativeByPackage.set(key, plugin);
      }
      const catalogPlugins = yield* Effect.forEach(
        [...representativeByPackage.values()],
        (plugin) => {
          const installTargets = plugin.detail.installTargets;
          const contents = installTargets.reduce(
            (current, target) => ({
              skillCount: Math.max(current.skillCount, target.contents.skillCount),
              mcpServerCount: Math.max(current.mcpServerCount, target.contents.mcpServerCount),
              appCount: Math.max(current.appCount, target.contents.appCount),
              commandCount: Math.max(current.commandCount, target.contents.commandCount),
              agentCount: Math.max(current.agentCount, target.contents.agentCount),
              ruleCount: Math.max(current.ruleCount, target.contents.ruleCount),
              hookCount: Math.max(current.hookCount, target.contents.hookCount),
              hasHooks: current.hasHooks || target.contents.hasHooks,
            }),
            {
              skillCount: 0,
              mcpServerCount: 0,
              appCount: 0,
              commandCount: 0,
              agentCount: 0,
              ruleCount: 0,
              hookCount: 0,
              hasHooks: false,
            },
          );
          const catalogDetail = {
            ...plugin.detail,
            installed: installTargets.some((target) => target.installed),
            enabled: installTargets.some((target) => target.installed && target.enabled),
            installPolicy: installTargets.some((target) => target.installPolicy === "AVAILABLE")
              ? "AVAILABLE"
              : plugin.detail.installPolicy,
            contents,
          } satisfies PluginMarketplaceDetail;
          return loadLogoDataUrl(
            catalogDetail.installed ? plugin.logoPath : null,
            MAX_CATALOG_LOGO_BYTES,
          ).pipe(Effect.map((logoDataUrl) => catalogPlugin(catalogDetail, logoDataUrl)));
        },
        { concurrency: 16 },
      );
      const plugins = new Map(loadedPlugins.map((plugin) => [plugin.detail.id, plugin]));
      const catalog = {
        plugins: catalogPlugins.toSorted(
          (left, right) =>
            Number(right.installed) - Number(left.installed) || left.name.localeCompare(right.name),
        ),
      } satisfies PluginMarketplaceCatalog;
      const now = yield* Clock.currentTimeMillis;
      const snapshot = { expiresAt: now + CATALOG_CACHE_TTL_MS, catalog, plugins };
      yield* Ref.set(cachedSnapshot, snapshot);
      return snapshot;
    });

    const getSnapshot = Effect.fn("CodexPluginMarketplace.getSnapshot")(function* () {
      const cached = yield* Ref.get(cachedSnapshot);
      const now = yield* Clock.currentTimeMillis;
      return cached && cached.expiresAt > now ? cached : yield* refreshSnapshot();
    });

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
      const bytes = yield* fileSystem.readFile(logoPath).pipe(Effect.option);
      if (Option.isNone(bytes) || bytes.value.byteLength > maxBytes) return null;
      return `data:${mimeType};base64,${Buffer.from(bytes.value).toString("base64")}`;
    });

    const findPlugin = Effect.fn("CodexPluginMarketplace.findPlugin")(function* (pluginId: string) {
      const snapshot = yield* getSnapshot();
      const plugin = snapshot.plugins.get(pluginId);
      if (!plugin) return yield* new PluginMarketplaceNotFoundError({ pluginId });
      return plugin;
    });

    const catalog = Effect.fn("CodexPluginMarketplace.catalog")(function* () {
      return (yield* getSnapshot()).catalog;
    });

    const detail = Effect.fn("CodexPluginMarketplace.detail")(function* (pluginId: string) {
      const plugin = yield* findPlugin(pluginId);
      const logoDataUrl = yield* loadLogoDataUrl(plugin.logoPath);
      const loaded = yield* loadRemotePreview(plugin).pipe(
        Effect.orElseSucceed(() => plugin.detail),
      );
      return { ...loaded, logoDataUrl };
    });

    const logo = Effect.fn("CodexPluginMarketplace.logo")(function* (pluginId: string) {
      const plugin = yield* findPlugin(pluginId);
      return {
        dataUrl: yield* loadLogoDataUrl(plugin.logoPath),
      } satisfies PluginMarketplaceLogo;
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
          timeout: "30 seconds",
          maxOutputBytes: 64 * 1024,
        })
        .pipe(
          Effect.mapError(
            () =>
              new PluginMarketplaceOperationError({
                operation: "setup",
                pluginId,
                detail: "macOS could not open the Computer Use permission setup.",
              }),
          ),
        );
      if (result.code !== 0) {
        return yield* new PluginMarketplaceOperationError({
          operation: "setup",
          pluginId,
          detail: publicOperationDetail(result.stderr, result.code),
        });
      }
      return { pluginId, action, opened: true } satisfies PluginMarketplaceSetupResult;
    });

    const mutate = Effect.fn("CodexPluginMarketplace.mutate")(function* (
      operation: "install" | "remove",
      pluginId: string,
    ) {
      const plugin = yield* findPlugin(pluginId);
      const usesCodexRuntime =
        plugin.record.harness === "codex" &&
        plugin.record.codexLegacyInstalled !== undefined &&
        options.codexPluginRuntime !== undefined;
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
      if (usesCodexRuntime && options.codexPluginRuntime) {
        const runtime = options.codexPluginRuntime;
        if (operation === "install") {
          yield* runtime.install(plugin.record.name).pipe(
            Effect.mapError(
              () =>
                new PluginMarketplaceOperationError({
                  operation,
                  pluginId,
                  detail: `Codex could not install ${plugin.detail.name} from its runtime catalog.`,
                }),
            ),
          );
        } else if (plugin.record.codexRuntimeInstalledId) {
          yield* runtime.remove(plugin.record.codexRuntimeInstalledId).pipe(
            Effect.mapError(
              () =>
                new PluginMarketplaceOperationError({
                  operation,
                  pluginId,
                  detail: `Codex could not uninstall ${plugin.detail.name} from its runtime catalog.`,
                }),
            ),
          );
        }

        if (plugin.record.codexLegacyInstalled) {
          yield* processRunner
            .run({
              command: "codex",
              args: ["plugin", "remove", plugin.record.sourcePluginId, "--json"],
              timeout: "60 seconds",
              maxOutputBytes: 1024 * 1024,
            })
            .pipe(
              Effect.tap((result) =>
                result.code === 0
                  ? Effect.void
                  : Effect.logWarning("Failed to remove a stale local Codex plugin shadow.", {
                      pluginId: plugin.record.sourcePluginId,
                    }),
              ),
              Effect.catch(() =>
                Effect.logWarning("Failed to remove a stale local Codex plugin shadow.", {
                  pluginId: plugin.record.sourcePluginId,
                }),
              ),
            );
        }

        yield* Ref.set(cachedSnapshot, null);
        if (options.onHarnessChanged) yield* options.onHarnessChanged("codex");
        return {
          pluginId,
          installed: operation === "install",
        } satisfies PluginMarketplaceMutationResult;
      }
      const command = operation === "install" ? "add" : "remove";
      const invocation =
        plugin.record.harness === "codex"
          ? {
              command: "codex",
              args: ["plugin", command, plugin.record.sourcePluginId, "--json"],
            }
          : {
              command: "claude",
              args: [
                "plugin",
                operation === "install" ? "install" : "uninstall",
                plugin.record.sourcePluginId,
                "--scope",
                "user",
                "--yes",
              ],
            };
      const result = yield* processRunner
        .run({
          ...invocation,
          timeout: "60 seconds",
          maxOutputBytes: 1024 * 1024,
        })
        .pipe(
          Effect.mapError(
            () =>
              new PluginMarketplaceOperationError({
                operation,
                pluginId,
                detail: `${plugin.record.harness === "codex" ? "Codex" : "Claude Code"} could not start the plugin operation.`,
              }),
          ),
        );
      if (result.code !== 0) {
        return yield* new PluginMarketplaceOperationError({
          operation,
          pluginId,
          detail: publicOperationDetail(result.stderr, result.code),
        });
      }
      yield* Ref.set(cachedSnapshot, null);
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
      setup,
      install: (pluginId) => mutate("install", pluginId),
      remove: (pluginId) => mutate("remove", pluginId),
    });
  });

export const makeCodexPluginRuntime = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const withClient = <A, E>(
    use: (client: CodexClient.CodexAppServerClient["Service"]) => Effect.Effect<A, E>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("codex", ["app-server"], {
            cwd: process.cwd(),
            env: process.env,
            extendEnv: true,
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
            title: "T3 Code Plugin Marketplace",
            version: "0.1.0",
          },
          capabilities: { experimentalApi: true },
        });
        yield* client.notify("initialized", undefined);
        return yield* use(client);
      }),
    );

  const normalize = (
    marketplaces: ReadonlyArray<{
      readonly name: string;
      readonly plugins: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly remotePluginId?: string | null;
        readonly installed: boolean;
        readonly enabled: boolean;
      }>;
    }>,
  ): ReadonlyArray<CodexRuntimePlugin> =>
    marketplaces.flatMap((marketplace) =>
      marketplace.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        marketplaceName: marketplace.name,
        remotePluginId: plugin.remotePluginId ?? null,
        installed: plugin.installed,
        enabled: plugin.enabled,
      })),
    );

  return {
    installed: () =>
      withClient((client) =>
        client
          .request("plugin/installed", { cwds: [process.cwd()] })
          .pipe(Effect.map((response) => normalize(response.marketplaces))),
      ).pipe(
        Effect.mapError(
          () =>
            new CodexPluginRuntimeError({
              operation: "installed",
              detail: "Codex could not report its installed runtime plugins.",
            }),
        ),
      ),
    install: (pluginName) =>
      withClient((client) =>
        Effect.gen(function* () {
          const response = yield* client.request("plugin/list", { cwds: [process.cwd()] });
          const candidate = normalize(response.marketplaces).find(
            (plugin) =>
              plugin.name.toLocaleLowerCase() === pluginName.toLocaleLowerCase() &&
              plugin.marketplaceName === "openai-curated-remote" &&
              plugin.remotePluginId,
          );
          if (!candidate?.remotePluginId) {
            return yield* new CodexPluginRuntimeError({
              operation: "install",
              detail: `Plugin '${pluginName}' was not found in the Codex runtime catalog.`,
            });
          }
          yield* client.request("plugin/install", {
            pluginName: candidate.remotePluginId,
            remoteMarketplaceName: candidate.marketplaceName,
          });
        }),
      ).pipe(
        Effect.mapError((error) =>
          isCodexPluginRuntimeError(error)
            ? error
            : new CodexPluginRuntimeError({
                operation: "install",
                detail: `Codex could not install '${pluginName}' from its runtime catalog.`,
              }),
        ),
      ),
    remove: (pluginId) =>
      withClient((client) =>
        client.request("plugin/uninstall", { pluginId }).pipe(Effect.asVoid),
      ).pipe(
        Effect.mapError(
          () =>
            new CodexPluginRuntimeError({
              operation: "remove",
              detail: `Codex could not uninstall '${pluginId}' from its runtime catalog.`,
            }),
        ),
      ),
  } satisfies CodexPluginRuntime;
});

export const make = Effect.gen(function* () {
  const codexPluginRuntime = yield* makeCodexPluginRuntime;

  return yield* makeWithOptions({
    codexPluginRuntime,
  });
});

export const layer = Layer.effect(CodexPluginMarketplace, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
