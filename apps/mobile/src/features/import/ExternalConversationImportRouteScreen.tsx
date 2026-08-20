import { LegendList } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import type { MenuAction } from "@react-native-menu/menu";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ExternalConversationSummary,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { ControlPill, ControlPillMenu } from "../../components/ControlPill";
import { ProviderIcon } from "../../components/ProviderIcon";
import { SymbolView } from "../../components/AppSymbol";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useProjects, useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";

function conversationKey(conversation: ExternalConversationSummary): string {
  return `${conversation.providerInstanceId}\u0000${conversation.externalThreadId}`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error && value.message.trim().length > 0
    ? value.message
    : "The conversation could not be imported.";
}

export function ExternalConversationImportRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    projects[0]?.environmentId ?? null,
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importConversation = useAtomCommand(orchestrationEnvironment.importExternalConversation, {
    reportFailure: false,
  });

  const environments = useMemo(() => {
    const ids = new Set(
      projects
        .filter(
          (project) =>
            serverConfigs.get(project.environmentId)?.environment.capabilities
              .externalConversationImport === true,
        )
        .map((project) => project.environmentId),
    );
    return Array.from(ids)
      .map((id) => ({
        environmentId: id,
        label: savedConnectionsById[id]?.environmentLabel ?? id,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [projects, savedConnectionsById, serverConfigs]);
  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const conversationQuery = useEnvironmentQuery(
    environmentId === null ||
      serverConfigs.get(environmentId)?.environment.capabilities.externalConversationImport !== true
      ? null
      : orchestrationEnvironment.externalConversations({
          environmentId,
          input: { limit: 500 },
        }),
  );
  const conversations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const available = conversationQuery.data?.conversations ?? [];
    if (normalizedQuery.length === 0) return available;
    return available.filter((conversation) =>
      [
        conversation.title,
        conversation.preview,
        conversation.cwd ?? "",
        conversation.providerLabel,
      ].some((candidate) => candidate.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [conversationQuery.data?.conversations, searchQuery]);

  useEffect(() => {
    if (
      environmentId === null ||
      !environments.some((environment) => environment.environmentId === environmentId)
    ) {
      setEnvironmentId(environments[0]?.environmentId ?? null);
    }
  }, [environmentId, environments]);

  useEffect(() => {
    if (!environmentProjects.some((project) => project.id === projectId)) {
      setProjectId(environmentProjects[0]?.id ?? null);
    }
  }, [environmentProjects, projectId]);

  const environmentActions = useMemo<MenuAction[]>(
    () =>
      environments.map((environment) => ({
        id: `environment:${environment.environmentId}`,
        title: environment.label,
        state: environment.environmentId === environmentId ? "on" : undefined,
      })),
    [environmentId, environments],
  );
  const projectActions = useMemo<MenuAction[]>(
    () =>
      environmentProjects.map((project) => ({
        id: `project:${project.id}`,
        title: project.title,
        subtitle: project.workspaceRoot,
        state: project.id === projectId ? "on" : undefined,
      })),
    [environmentProjects, projectId],
  );
  const environmentLabel =
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "Environment";
  const projectLabel =
    environmentProjects.find((project) => project.id === projectId)?.title ?? "Project";

  const openThread = useCallback(
    (threadId: ThreadId) => {
      if (environmentId === null) return;
      navigation.navigate("Thread", { environmentId, threadId });
    },
    [environmentId, navigation],
  );

  const handleConversationPress = useCallback(
    async (conversation: ExternalConversationSummary) => {
      if (environmentId === null || projectId === null || importingKey !== null) return;
      if (conversation.importedThreadId) {
        openThread(conversation.importedThreadId);
        return;
      }

      const key = conversationKey(conversation);
      setImportError(null);
      setImportingKey(key);
      const result = await importConversation({
        environmentId,
        input: {
          externalThreadId: conversation.externalThreadId,
          projectId,
          providerInstanceId: conversation.providerInstanceId,
        },
      });
      setImportingKey(null);
      if (result._tag === "Failure") {
        setImportError(errorMessage(squashAtomCommandFailure(result)));
        return;
      }
      openThread(result.value.threadId);
    },
    [environmentId, importConversation, importingKey, openThread, projectId],
  );

  const renderConversation = useCallback(
    ({ item: conversation }: { readonly item: ExternalConversationSummary }) => {
      const key = conversationKey(conversation);
      const isImporting = importingKey === key;
      return (
        <Pressable
          accessibilityLabel={`${conversation.importedThreadId ? "Open" : "Import"} ${conversation.title}`}
          accessibilityRole="button"
          className="mb-2 flex-row items-start gap-3 rounded-[20px] bg-card p-4 active:opacity-70"
          disabled={importingKey !== null || projectId === null}
          onPress={() => void handleConversationPress(conversation)}
        >
          <View className="mt-0.5 size-9 items-center justify-center rounded-xl bg-subtle">
            <ProviderIcon provider={conversation.provider} size={17} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="min-w-0 flex-1 text-base font-t3-bold text-foreground"
                numberOfLines={1}
              >
                {conversation.title}
              </Text>
              <Text className="text-xs tabular-nums text-foreground-tertiary">
                {relativeTime(conversation.updatedAt)}
              </Text>
            </View>
            <Text className="text-sm text-foreground-muted" numberOfLines={2}>
              {conversation.preview || conversation.cwd || conversation.providerLabel}
            </Text>
            <View className="mt-1 flex-row items-center gap-2">
              <Text className="text-xs text-foreground-tertiary">{conversation.providerLabel}</Text>
              {conversation.cwd ? (
                <Text
                  className="min-w-0 flex-1 font-mono text-2xs text-foreground-tertiary"
                  numberOfLines={1}
                >
                  {conversation.cwd}
                </Text>
              ) : (
                <View className="flex-1" />
              )}
              {isImporting ? (
                <ActivityIndicator size="small" />
              ) : conversation.importedThreadId ? (
                <View className="flex-row items-center gap-1">
                  <SymbolView name="checkmark" size={12} tintColor={iconColor} type="monochrome" />
                  <Text className="text-xs font-t3-medium text-foreground-muted">Imported</Text>
                </View>
              ) : (
                <Text className="text-xs font-t3-medium text-foreground">Import</Text>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [handleConversationPress, iconColor, importingKey, projectId],
  );

  const listHeader = (
    <View className="gap-4 pb-4">
      <Text className="text-sm leading-relaxed text-foreground-muted">
        Bring Claude Code and Codex conversations into T3 Code with their complete tool call
        history.
      </Text>
      <View className="flex-row gap-2">
        <ControlPillMenu
          actions={environmentActions}
          onPressAction={(event) => {
            const id = event.nativeEvent.event;
            const selected = environments.find(
              (environment) => id === `environment:${environment.environmentId}`,
            );
            if (!selected) return;
            setEnvironmentId(selected.environmentId);
            setImportError(null);
          }}
        >
          <ControlPill
            accessibilityLabel="Choose import environment"
            icon="server.rack"
            label={environmentLabel}
            variant="pill"
          />
        </ControlPillMenu>
        <ControlPillMenu
          actions={projectActions}
          onPressAction={(event) => {
            const id = event.nativeEvent.event;
            const selected = environmentProjects.find((project) => id === `project:${project.id}`);
            if (selected) setProjectId(selected.id);
          }}
        >
          <ControlPill
            accessibilityLabel="Choose target project"
            disabled={environmentProjects.length === 0}
            icon="folder"
            label={projectLabel}
            variant="pill"
          />
        </ControlPillMenu>
      </View>
      <View className="h-11 flex-row items-center gap-2.5 rounded-2xl bg-input px-3.5">
        <SymbolView name="magnifyingglass" size={17} tintColor={iconColor} type="monochrome" />
        <TextInput
          accessibilityLabel="Search external conversations"
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 py-2 text-base text-foreground"
          onChangeText={setSearchQuery}
          placeholder="Search conversations"
          placeholderTextColorClassName="accent-placeholder"
          value={searchQuery}
        />
      </View>
      {importError ? (
        <View className="rounded-2xl bg-danger-subtle p-3">
          <Text className="text-sm text-danger">{importError}</Text>
        </View>
      ) : null}
    </View>
  );

  const emptyState = conversationQuery.isPending ? (
    <View className="items-center gap-3 py-12">
      <ActivityIndicator />
      <Text className="text-sm text-foreground-muted">Finding local conversations…</Text>
    </View>
  ) : conversationQuery.error ? (
    <View className="items-center gap-3 py-12">
      <Text className="text-center text-sm text-danger">{conversationQuery.error}</Text>
      <ControlPill label="Try again" onPress={conversationQuery.refresh} variant="pill" />
    </View>
  ) : (
    <View className="items-center gap-2 px-6 py-12">
      <Text className="text-center text-lg font-t3-bold text-foreground">
        {environments.length === 0
          ? "No compatible environment"
          : searchQuery.trim()
            ? "No matching conversations"
            : "No conversations found"}
      </Text>
      <Text className="text-center text-sm leading-relaxed text-foreground-muted">
        {environments.length === 0
          ? "Connect to an updated T3 Code environment with a configured Claude Code or Codex provider."
          : searchQuery.trim()
            ? "Try a different search."
            : "No Claude Code or Codex history was found on this environment."}
      </Text>
    </View>
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Import Conversations" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <LegendList
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
        contentInsetAdjustmentBehavior="automatic"
        data={conversations}
        estimatedItemSize={112}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={conversationKey}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={listHeader}
        renderItem={renderConversation}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
