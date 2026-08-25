/**
 * Collapsible "Team" shelf under the mobile thread list: teammates' shared
 * threads with a static status dot, owner, and compact activity time —
 * the mobile port of web's MtTeamsSidebarSection. Tapping a row opens a
 * small modal with a message box that posts into the owner's thread via the
 * team service (`/api/messages/send`). Renders nothing while signed out or
 * in builds without a team service origin. The header mirrors the settled
 * shelf's idiom (thread-list-v2-items.tsx); dots are static — no continuous
 * animation.
 */
import { memo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";

import { SymbolView } from "../components/AppSymbol";
import { AppText as Text } from "../components/AppText";
import { relativeTime } from "../lib/time";
import { useThemeColor } from "../lib/useThemeColor";
import { type MtTeamsSharedThread, sendMessage } from "./client";
import { getMtTeamsSession, useMtTeamsSelector, useMtTeamsSync } from "./state";
import { mtTeamsStatusDotClassName, mtTeamsStatusLabel } from "./statusDot";

export const MtTeamsTeamShelf = memo(function MtTeamsTeamShelf(props: {
  readonly pane?: "screen" | "sidebar";
}) {
  useMtTeamsSync();
  const signedIn = useMtTeamsSelector((state) => state.sessionToken.length > 0);
  const meUserId = useMtTeamsSelector((state) => state.me?.user.id ?? null);
  const sharedThreads = useMtTeamsSelector((state) => state.sharedThreads);
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<MtTeamsSharedThread | null>(null);
  const mutedColor = useThemeColor("--color-foreground-muted");

  if (!signedIn) return null;

  const teammateThreads =
    meUserId === null
      ? sharedThreads
      : sharedThreads.filter((thread) => thread.ownerUserId !== meUserId);

  const paddingClass = props.pane === "sidebar" ? "px-3" : "px-5";

  return (
    <View>
      <Pressable
        accessibilityHint={
          expanded ? "Collapses the teammate threads." : "Expands the teammate threads."
        }
        accessibilityLabel={
          teammateThreads.length === 1
            ? "1 teammate thread"
            : `${teammateThreads.length} teammate threads`
        }
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className={`mb-1.5 mt-4 flex-row items-center gap-2.5 ${paddingClass}`}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text className="text-xs font-t3-medium text-foreground-tertiary">
          {expanded || teammateThreads.length === 0 ? "Team" : `Team (${teammateThreads.length})`}
        </Text>
        <View className="h-px flex-1 bg-border" />
        <SymbolView
          name="chevron.down"
          size={10}
          tintColor={mutedColor}
          type="monochrome"
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>
      {expanded ? (
        teammateThreads.length > 0 ? (
          teammateThreads.map((thread) => (
            <Pressable
              key={thread.sharedThreadId}
              accessibilityRole="button"
              accessibilityLabel={`${thread.title}, ${thread.ownerName}, ${mtTeamsStatusLabel(thread.status)}`}
              onPress={() => setSelected(thread)}
              className={`flex-row items-center gap-2.5 py-2 ${paddingClass}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <View
                className={`h-2 w-2 rounded-full ${mtTeamsStatusDotClassName(thread.status)}`}
              />
              <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                {thread.title}
              </Text>
              <Text className="shrink-0 text-xs text-foreground-muted" numberOfLines={1}>
                {thread.ownerName}
              </Text>
              <Text className="shrink-0 text-xs text-foreground-muted/70">
                {relativeTime(thread.updatedAt)}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text className={`py-1 text-sm text-foreground-muted ${paddingClass}`}>
            No teammate threads shared yet.
          </Text>
        )
      ) : null}
      {selected ? (
        <MtTeamsMessageModal thread={selected} onClose={() => setSelected(null)} />
      ) : null}
    </View>
  );
});

/** Small centered dialog with a message box posting into the shared thread. */
function MtTeamsMessageModal(props: {
  readonly thread: MtTeamsSharedThread;
  readonly onClose: () => void;
}) {
  const { thread, onClose } = props;
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const foreground = useThemeColor("--color-foreground");
  const placeholder = useThemeColor("--color-foreground-muted");

  const send = async () => {
    if (pending || text.trim().length === 0) return;
    setPending(true);
    setFeedback(null);
    try {
      await sendMessage(getMtTeamsSession(), {
        sharedThreadId: thread.sharedThreadId,
        text: text.trim(),
      });
      setText("");
      setFeedback("Sent.");
    } catch (cause) {
      setFeedback(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Could not send the message.",
      );
    }
    setPending(false);
  };

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        className="flex-1 items-center justify-center bg-black/40 px-6"
        onPress={onClose}
      >
        {/* Stop taps inside the card from closing the modal. */}
        <Pressable onPress={() => undefined} className="w-full max-w-[420px]">
          <View className="gap-3 rounded-[24px] bg-card p-4">
            <View className="gap-0.5">
              <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
                {thread.title}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {thread.ownerName} · {thread.environmentLabel} · {mtTeamsStatusLabel(thread.status)}
              </Text>
            </View>
            <TextInput
              autoCapitalize="sentences"
              editable={!pending}
              multiline
              numberOfLines={3}
              placeholder={`Message ${thread.ownerName}…`}
              placeholderTextColor={placeholder}
              value={text}
              onChangeText={setText}
              className="min-h-[80px] rounded-xl bg-subtle px-4 py-3 text-base"
              style={{ color: foreground, textAlignVertical: "top" }}
              accessibilityLabel={`Message ${thread.ownerName}`}
            />
            {feedback ? <Text className="text-sm text-foreground-muted">{feedback}</Text> : null}
            <View className="flex-row items-center justify-end gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                className="px-3 py-2"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text className="text-sm font-t3-medium text-foreground-muted">Close</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={pending || text.trim().length === 0}
                onPress={() => void send()}
                className="h-9 min-w-[72px] items-center justify-center rounded-full bg-primary px-4 disabled:opacity-50"
              >
                {pending ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text className="text-sm font-t3-bold text-primary-foreground">Send</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
