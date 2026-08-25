/**
 * Settings → MT Teams: the mobile port of web's MtTeamsSettings panel
 * (apps/web/src/mtTeams/MtTeamsSettings.tsx), structured like the Voice
 * Dictation settings screen. Sign in to the team service, accept or decline
 * invitations addressed to your account email, create teams, and invite
 * teammates by email.
 *
 * The service origin is baked into the build (`extra.mtTeams.url`) and never
 * rendered; without it the screen shows a single quiet line. Phones are
 * clients, not environments, so there is no environment bridge or
 * share-thread UI here — teammates' shared threads surface in the Team shelf
 * on the thread list.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/AppText";
import { useThemeColor } from "../lib/useThemeColor";
import { relativeTime } from "../lib/time";
import { SettingsSection } from "../features/settings/components/SettingsSection";
import {
  acceptInvite,
  createTeam,
  declineInvite,
  inviteToTeam,
  leaveTeam,
  type MtTeamsTeam,
  removeTeamMember,
  revokeInvite,
} from "./client";
import {
  getMtTeamsSession,
  isMtTeamsConfigured,
  mtTeamsSignIn,
  mtTeamsSignOut,
  mtTeamsSignUp,
  refreshMtTeamsMe,
  refreshMtTeamsTeamInvites,
  useMtTeamsSelector,
  useMtTeamsSync,
} from "./state";

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The MT Teams request failed.";
}

function epochMsRelativeLabel(epochMs: number): string {
  return relativeTime(new Date(epochMs).toISOString());
}

/** Up to two initials from a display name (falls back to the email). */
export function mtTeamsInitials(name: string, email: string): string {
  const source = name.trim().length > 0 ? name.trim() : email.trim();
  const parts = source.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  const initials = `${first}${last}`.toUpperCase();
  return initials.length > 0 ? initials : "?";
}

function InitialsAvatar(props: { readonly name: string; readonly email: string }) {
  return (
    <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle">
      <Text className="text-xs font-t3-medium text-foreground-muted">
        {mtTeamsInitials(props.name, props.email)}
      </Text>
    </View>
  );
}

/** Small inline text button used for row actions (Accept, Remove, Revoke…). */
function InlineButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly tone?: "primary" | "muted";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      className="px-2 py-1.5 disabled:opacity-50"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text
        className={
          props.tone === "muted"
            ? "text-sm font-t3-medium text-foreground-muted"
            : "text-sm font-t3-medium text-blue-600 dark:text-blue-400"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function SettingsMtTeamsRouteScreen() {
  useMtTeamsSync();
  const insets = useSafeAreaInsets();
  const signedIn = useMtTeamsSelector((state) => state.sessionToken.length > 0);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {isMtTeamsConfigured() ? (
          signedIn ? (
            <MtTeamsSignedInSections />
          ) : (
            <MtTeamsAuthSection />
          )
        ) : (
          <Text className="px-2 text-sm text-foreground-muted">
            Team service not configured in this build.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function MtTeamsAuthSection() {
  const authPending = useMtTeamsSelector((state) => state.authPending);
  const authError = useMtTeamsSelector((state) => state.authError);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const foreground = useThemeColor("--color-foreground");
  const placeholder = useThemeColor("--color-foreground-muted");

  const canSubmit =
    !authPending &&
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === "sign-in" || name.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    const succeeded =
      mode === "sign-in"
        ? await mtTeamsSignIn(email.trim(), password)
        : await mtTeamsSignUp(name.trim(), email.trim(), password);
    if (succeeded) setPassword("");
  };

  return (
    <>
      <SettingsSection title="Account">
        <View className="gap-3 p-4">
          {mode === "sign-up" ? (
            <TextInput
              autoCapitalize="words"
              autoComplete="name"
              autoCorrect={false}
              editable={!authPending}
              placeholder="Name"
              placeholderTextColor={placeholder}
              value={name}
              onChangeText={setName}
              className="rounded-xl bg-subtle px-4 py-3 text-base"
              style={{ color: foreground }}
              accessibilityLabel="Name"
            />
          ) : null}
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!authPending}
            inputMode="email"
            placeholder="you@example.com"
            placeholderTextColor={placeholder}
            value={email}
            onChangeText={setEmail}
            className="rounded-xl bg-subtle px-4 py-3 text-base"
            style={{ color: foreground }}
            accessibilityLabel="Email"
          />
          <TextInput
            autoCapitalize="none"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            autoCorrect={false}
            editable={!authPending}
            placeholder="Password"
            placeholderTextColor={placeholder}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            className="rounded-xl bg-subtle px-4 py-3 text-base"
            style={{ color: foreground }}
            accessibilityLabel="Password"
          />
          {authError ? <Text className="text-sm text-danger-foreground">{authError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => void submit()}
            className="h-11 items-center justify-center rounded-full bg-primary disabled:opacity-50"
          >
            {authPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-t3-bold text-primary-foreground">
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            className="items-center py-1"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text className="text-sm font-t3-medium text-blue-600 dark:text-blue-400">
              {mode === "sign-in" ? "Need an account?" : "Have an account?"}
            </Text>
          </Pressable>
        </View>
      </SettingsSection>
      <Text className="px-2 text-sm leading-5 text-foreground-muted">
        Teammates' invites find you by this email.
      </Text>
    </>
  );
}

function MtTeamsSignedInSections() {
  const userName = useMtTeamsSelector((state) => state.userName);
  const me = useMtTeamsSelector((state) => state.me);
  const syncError = useMtTeamsSelector((state) => state.syncError);

  return (
    <>
      <MtTeamsInvitationsSection />
      <SettingsSection title="Account">
        <View className="flex-row items-center gap-4 p-4">
          <InitialsAvatar name={me?.user.name ?? userName} email={me?.user.email ?? ""} />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {me?.user.name ?? userName}
            </Text>
            {me?.user.email ? (
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {me.user.email}
              </Text>
            ) : null}
          </View>
          <InlineButton label="Sign out" tone="muted" onPress={() => void mtTeamsSignOut()} />
        </View>
      </SettingsSection>
      {syncError ? <Text className="px-2 text-sm text-danger-foreground">{syncError}</Text> : null}
      <MtTeamsTeamsSection />
    </>
  );
}

/**
 * Pending invites addressed to the signed-in account's email, with
 * Accept/Decline. Renders nothing when there are none; when there are, it
 * sits at the top of the screen (the Settings row shows a count badge).
 */
function MtTeamsInvitationsSection() {
  const myInvites = useMtTeamsSelector((state) => state.myInvites);
  const [pendingInviteId, setPendingInviteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (myInvites.length === 0) return null;

  const respond = async (inviteId: string, action: "accept" | "decline") => {
    if (pendingInviteId !== null) return;
    setPendingInviteId(inviteId);
    setError(null);
    try {
      if (action === "accept") {
        await acceptInvite(getMtTeamsSession(), { inviteId });
      } else {
        await declineInvite(getMtTeamsSession(), { inviteId });
      }
      await refreshMtTeamsMe();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPendingInviteId(null);
  };

  return (
    <SettingsSection title="Invitations">
      {myInvites.map((invite, index) => (
        <View
          key={invite.inviteId}
          className={
            index === 0
              ? "flex-row items-center gap-3 p-4"
              : "flex-row items-center gap-3 border-t border-border-subtle p-4"
          }
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {invite.teamName}
            </Text>
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              Invited by {invite.invitedByName} · {epochMsRelativeLabel(invite.createdAt)}
            </Text>
          </View>
          <InlineButton
            label="Accept"
            disabled={pendingInviteId !== null}
            onPress={() => void respond(invite.inviteId, "accept")}
          />
          <InlineButton
            label="Decline"
            tone="muted"
            disabled={pendingInviteId !== null}
            onPress={() => void respond(invite.inviteId, "decline")}
          />
        </View>
      ))}
      {error ? <Text className="px-4 pb-3 text-sm text-danger-foreground">{error}</Text> : null}
    </SettingsSection>
  );
}

function MtTeamsTeamsSection() {
  const me = useMtTeamsSelector((state) => state.me);
  const [teamName, setTeamName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foreground = useThemeColor("--color-foreground");
  const placeholder = useThemeColor("--color-foreground-muted");

  const runCreate = async () => {
    if (teamName.trim().length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      await createTeam(getMtTeamsSession(), { name: teamName.trim() });
      setTeamName("");
      await refreshMtTeamsMe();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(false);
  };

  return (
    <>
      {me && me.teams.length > 0 ? (
        me.teams.map((team) => <MtTeamsTeamCard key={team.id} team={team} meUserId={me.user.id} />)
      ) : (
        <Text className="px-2 text-sm text-foreground-muted">
          No teams yet. Create one, or ask a teammate to invite you.
        </Text>
      )}
      <SettingsSection title="New team">
        <View className="flex-row items-center gap-3 p-4">
          <TextInput
            autoCapitalize="words"
            autoCorrect={false}
            editable={!pending}
            placeholder="Team name"
            placeholderTextColor={placeholder}
            value={teamName}
            onChangeText={setTeamName}
            className="flex-1 rounded-xl bg-subtle px-4 py-3 text-base"
            style={{ color: foreground }}
            accessibilityLabel="New team name"
          />
          <InlineButton
            label="Create"
            disabled={teamName.trim().length === 0 || pending}
            onPress={() => void runCreate()}
          />
        </View>
        {error ? <Text className="px-4 pb-3 text-sm text-danger-foreground">{error}</Text> : null}
      </SettingsSection>
      <Text className="px-2 text-sm leading-5 text-foreground-muted">
        Teammates in a team see each other's shared threads and can message into them. Invite
        teammates by the email they use for their team account.
      </Text>
    </>
  );
}

function MtTeamsTeamCard(props: { readonly team: MtTeamsTeam; readonly meUserId: string }) {
  const { team, meUserId } = props;
  const teamInvites = useMtTeamsSelector((state) => state.teamInvites);
  const [inviteEmail, setInviteEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foreground = useThemeColor("--color-foreground");
  const placeholder = useThemeColor("--color-foreground-muted");

  const invites = teamInvites[team.id] ?? [];

  const run = async (action: () => Promise<unknown>, refresh: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(false);
  };

  const runInvite = async () => {
    const email = inviteEmail.trim();
    if (email.length === 0) return;
    await run(
      () => inviteToTeam(getMtTeamsSession(), { teamId: team.id, email }),
      refreshMtTeamsTeamInvites,
    );
    setInviteEmail("");
  };

  const confirmLeave = () => {
    Alert.alert("Leave team", `Leave ${team.name}? You will stop seeing its shared threads.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () =>
          void run(() => leaveTeam(getMtTeamsSession(), { teamId: team.id }), refreshMtTeamsMe),
      },
    ]);
  };

  const confirmRemove = (userId: string, name: string) => {
    Alert.alert("Remove member", `Remove ${name} from ${team.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void run(
            () => removeTeamMember(getMtTeamsSession(), { teamId: team.id, userId }),
            refreshMtTeamsMe,
          ),
      },
    ]);
  };

  return (
    <SettingsSection title={team.name}>
      {team.members.map((member, index) => (
        <View
          key={member.userId}
          className={
            index === 0
              ? "flex-row items-center gap-3 p-4"
              : "flex-row items-center gap-3 border-t border-border-subtle p-4"
          }
        >
          <InitialsAvatar name={member.name} email={member.email} />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {member.name}
            </Text>
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              {member.email}
            </Text>
          </View>
          {member.userId !== meUserId ? (
            <InlineButton
              label="Remove"
              tone="muted"
              disabled={pending}
              onPress={() => confirmRemove(member.userId, member.name)}
            />
          ) : null}
        </View>
      ))}
      {invites.map((invite) => (
        <View
          key={invite.inviteId}
          className="flex-row items-center gap-3 border-t border-border-subtle p-4"
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground-muted" numberOfLines={1}>
              {invite.email}
            </Text>
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              Invited by {invite.invitedByName} · {epochMsRelativeLabel(invite.createdAt)}
            </Text>
          </View>
          <InlineButton
            label="Revoke"
            tone="muted"
            disabled={pending}
            onPress={() =>
              void run(
                () => revokeInvite(getMtTeamsSession(), { inviteId: invite.inviteId }),
                refreshMtTeamsTeamInvites,
              )
            }
          />
        </View>
      ))}
      <View className="flex-row items-center gap-3 border-t border-border-subtle p-4">
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          inputMode="email"
          placeholder="teammate@example.com"
          placeholderTextColor={placeholder}
          value={inviteEmail}
          onChangeText={setInviteEmail}
          className="flex-1 rounded-xl bg-subtle px-4 py-3 text-base"
          style={{ color: foreground }}
          accessibilityLabel={`Invite to ${team.name} by email`}
        />
        <InlineButton
          label="Invite"
          disabled={inviteEmail.trim().length === 0 || pending}
          onPress={() => void runInvite()}
        />
      </View>
      <View className="border-t border-border-subtle">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Leave ${team.name}`}
          disabled={pending}
          onPress={confirmLeave}
          className="items-start p-4 disabled:opacity-50"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text className="text-sm font-t3-medium text-danger-foreground">Leave team</Text>
        </Pressable>
      </View>
      {error ? <Text className="px-4 pb-3 text-sm text-danger-foreground">{error}</Text> : null}
    </SettingsSection>
  );
}
