import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ExternalConversationSummary,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeftIcon, CheckIcon, DownloadIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { orchestrationEnvironment } from "../state/orchestration";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useServerConfigs, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { cn } from "../lib/utils";
import { ClaudeAI, OpenAI } from "./Icons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";

function conversationKey(conversation: ExternalConversationSummary): string {
  return `${conversation.providerInstanceId}\u0000${conversation.externalThreadId}`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error && value.message.trim().length > 0
    ? value.message
    : "The conversation could not be imported.";
}

export function ExternalConversationImportDialog({
  onBack,
  onClose,
}: {
  readonly onBack: () => void;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const threads = useThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThread =
    routeTarget?.kind === "server"
      ? threads.find(
          (thread) =>
            thread.environmentId === routeTarget.threadRef.environmentId &&
            thread.id === routeTarget.threadRef.threadId,
        )
      : undefined;
  const defaultEnvironmentId =
    routeThread?.environmentId ?? primaryEnvironmentId ?? projects[0]?.environmentId ?? null;
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(defaultEnvironmentId);
  const [projectId, setProjectId] = useState<ProjectId | null>(routeThread?.projectId ?? null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importConversation = useAtomCommand(orchestrationEnvironment.importExternalConversation, {
    reportFailure: false,
  });
  const conversationQuery = useEnvironmentQuery(
    environmentId === null ||
      serverConfigs.get(environmentId)?.environment.capabilities.externalConversationImport !== true
      ? null
      : orchestrationEnvironment.externalConversations({
          environmentId,
          input: { limit: 500 },
        }),
  );
  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const conversations = conversationQuery.data?.conversations ?? [];
    if (normalized.length === 0) return conversations;
    return conversations.filter((conversation) =>
      [
        conversation.title,
        conversation.preview,
        conversation.cwd ?? "",
        conversation.providerLabel,
      ].some((candidate) => candidate.toLowerCase().includes(normalized)),
    );
  }, [conversationQuery.data?.conversations, query]);
  const selectedConversation = useMemo(
    () =>
      visibleConversations.find((conversation) => conversationKey(conversation) === selectedKey) ??
      visibleConversations[0] ??
      null,
    [selectedKey, visibleConversations],
  );

  useEffect(() => {
    if (environmentId === null || environmentProjects.length === 0) {
      if (projectId !== null) setProjectId(null);
      return;
    }
    const currentExists = environmentProjects.some((project) => project.id === projectId);
    if (!currentExists) setProjectId(environmentProjects[0]!.id);
  }, [environmentId, environmentProjects, projectId]);

  useEffect(() => {
    if (!selectedConversation?.cwd) return;
    const matchingProject = environmentProjects.find(
      (project) => project.workspaceRoot === selectedConversation.cwd,
    );
    if (matchingProject) setProjectId(matchingProject.id);
  }, [environmentProjects, selectedConversation?.cwd]);

  const environmentItems = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .filter(
              (project) =>
                serverConfigs.get(project.environmentId)?.environment.capabilities
                  .externalConversationImport === true,
            )
            .map((project) => project.environmentId),
        ),
      ).map((id) => ({
        value: id,
        label: environments.find((environment) => environment.environmentId === id)?.label ?? id,
      })),
    [environments, projects, serverConfigs],
  );

  useEffect(() => {
    if (
      environmentId === null ||
      !environmentItems.some((environment) => environment.value === environmentId)
    ) {
      setEnvironmentId(environmentItems[0]?.value ?? null);
    }
  }, [environmentId, environmentItems]);

  const projectItems = useMemo(
    () => environmentProjects.map((project) => ({ value: project.id, label: project.title })),
    [environmentProjects],
  );

  const navigateToThread = useCallback(
    async (threadId: ThreadId) => {
      if (environmentId === null) return;
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
      onClose();
    },
    [environmentId, navigate, onClose],
  );

  const handleImport = useCallback(async () => {
    if (!selectedConversation || !environmentId || !projectId) return;
    if (selectedConversation.importedThreadId) {
      await navigateToThread(selectedConversation.importedThreadId);
      return;
    }
    const key = conversationKey(selectedConversation);
    setError(null);
    setImportingKey(key);
    const result = await importConversation({
      environmentId,
      input: {
        providerInstanceId: selectedConversation.providerInstanceId,
        externalThreadId: selectedConversation.externalThreadId,
        projectId,
      },
    });
    setImportingKey(null);
    if (result._tag === "Failure") {
      setError(errorMessage(squashAtomCommandFailure(result)));
      return;
    }
    await navigateToThread(result.value.threadId);
  }, [environmentId, importConversation, navigateToThread, projectId, selectedConversation]);

  return (
    <div className="flex h-[min(620px,calc(100vh-5rem))] flex-col">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <Button aria-label="Back to commands" size="icon-sm" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading font-semibold text-base">Import conversation</h2>
          <p className="text-muted-foreground text-xs">
            Bring in Claude Code or Codex messages and complete tool history.
          </p>
        </div>
      </div>

      <div className="grid gap-2 border-b p-3 sm:grid-cols-2">
        <Select
          value={environmentId}
          items={environmentItems}
          onValueChange={(value) => {
            setEnvironmentId(value as EnvironmentId);
            setSelectedKey(null);
            setError(null);
          }}
        >
          <SelectTrigger aria-label="Import from environment" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {environmentItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <label className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search conversations"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {conversationQuery.isPending && conversationQuery.data === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Finding local conversations…
            </div>
          ) : conversationQuery.error ? (
            <div className="p-8 text-center text-destructive text-sm">
              <p>{conversationQuery.error}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={conversationQuery.refresh}
              >
                Try again
              </Button>
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              {environmentItems.length === 0
                ? "No connected environment supports conversation imports."
                : query.trim()
                  ? "No conversations match your search."
                  : "No Claude Code or Codex conversations were found on this environment."}
            </div>
          ) : (
            visibleConversations.map((conversation) => {
              const key = conversationKey(conversation);
              const selected =
                selectedConversation !== null && conversationKey(selectedConversation) === key;
              const ProviderIcon = conversation.provider === "claudeAgent" ? ClaudeAI : OpenAI;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected ? "border-ring/50 bg-accent" : "border-transparent hover:bg-accent/60",
                  )}
                  onClick={() => {
                    setSelectedKey(key);
                    setError(null);
                  }}
                  onDoubleClick={() => {
                    setSelectedKey(key);
                    if (conversation.importedThreadId)
                      void navigateToThread(conversation.importedThreadId);
                  }}
                >
                  <ProviderIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-sm">
                        {conversation.title}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-[11px]">
                        {formatRelativeTimeLabel(conversation.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                      {conversation.preview || conversation.cwd || conversation.providerLabel}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-muted-foreground/75 text-[11px]">
                      <span>{conversation.providerLabel}</span>
                      {conversation.cwd ? (
                        <span className="truncate">{conversation.cwd}</span>
                      ) : null}
                      {conversation.importedThreadId ? (
                        <span className="ms-auto inline-flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckIcon className="size-3" /> Imported
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="space-y-2 border-t bg-muted/35 p-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-muted-foreground text-xs">Add to</span>
          <Select
            value={projectId}
            items={projectItems}
            onValueChange={(value) => setProjectId(value as ProjectId)}
          >
            <SelectTrigger aria-label="Target project" className="min-w-0 flex-1" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {environmentProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <span className="flex min-w-0 flex-col">
                    <span>{project.title}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {project.workspaceRoot}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button
            size="sm"
            disabled={!selectedConversation || !projectId || importingKey !== null}
            onClick={() => void handleImport()}
          >
            {importingKey !== null ? (
              <Spinner className="size-3.5" />
            ) : selectedConversation?.importedThreadId ? (
              <CheckIcon />
            ) : (
              <DownloadIcon />
            )}
            {selectedConversation?.importedThreadId ? "Open" : "Import"}
          </Button>
        </div>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>
    </div>
  );
}
