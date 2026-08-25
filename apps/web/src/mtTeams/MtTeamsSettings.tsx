/**
 * Settings → MT Teams: its own top-level settings panel (route
 * `/settings/mt-teams`, structured like Computer Use). Sign in to the team
 * service, accept or decline invitations addressed to your account email,
 * create teams and invite teammates by email, enable the environment bridge,
 * and share/unshare this account's threads.
 *
 * The service origin is baked into the build (`VITE_MT_TEAMS_URL`) and never
 * rendered; without it the panel shows a single quiet line. Invite codes are
 * retired — membership flows through email invites (docs/internals/mt-teams.md).
 */
import { useState } from "react";
import { UsersIcon } from "lucide-react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { usePrimaryEnvironment } from "../state/environments";
import { formatRelativeTimeLabel } from "../timestampFormat";
import {
  acceptInvite,
  createTeam,
  declineInvite,
  defaultServiceUrl,
  inviteToTeam,
  leaveTeam,
  type MtTeamsTeam,
  registerEnvironment,
  removeTeamMember,
  revokeInvite,
  shareThread,
  unshareThread,
} from "./client";
import { useMtTeamsBridgeStatus, useMtTeamsConfigure } from "./serverRpc";
import {
  getMtTeamsSession,
  isMtTeamsConfigured,
  useMtTeamsSelector,
  useMtTeamsSync,
} from "./state";
import { mtTeamsStatusLabel } from "./statusDot";

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The MT Teams request failed.";
}

function relativeLabelFromEpochMs(epochMs: number): string {
  return formatRelativeTimeLabel(new Date(epochMs).toISOString());
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

function InitialsAvatar({ name, email }: { readonly name: string; readonly email: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
    >
      {mtTeamsInitials(name, email)}
    </span>
  );
}

/** The `/settings/mt-teams` route component. */
export function MtTeamsSettingsPage() {
  return (
    <SettingsPageContainer>
      <MtTeamsSettings />
    </SettingsPageContainer>
  );
}

export function MtTeamsSettings() {
  useMtTeamsSync();
  const signedIn = useMtTeamsSelector((state) => state.sessionToken.length > 0);

  return (
    <SettingsSection {...searchableSetting("mt-teams")} icon={<UsersIcon className="size-3.5" />}>
      {isMtTeamsConfigured() ? (
        signedIn ? (
          <MtTeamsSignedInRows />
        ) : (
          <MtTeamsAuthRow />
        )
      ) : (
        <p className="px-3 py-2 text-[13px] text-muted-foreground/80 sm:px-4">
          Team service not configured in this build.
        </p>
      )}
    </SettingsSection>
  );
}

function MtTeamsAuthRow() {
  const authPending = useMtTeamsSelector((state) => state.authPending);
  const authError = useMtTeamsSelector((state) => state.authError);
  const storeSignIn = useMtTeamsSelector((state) => state.signIn);
  const storeSignUp = useMtTeamsSelector((state) => state.signUp);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit =
    !authPending &&
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === "sign-in" || name.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    const succeeded =
      mode === "sign-in"
        ? await storeSignIn(email.trim(), password)
        : await storeSignUp(name.trim(), email.trim(), password);
    if (succeeded) {
      setPassword("");
    }
  };

  return (
    <SettingsRow
      title="Account"
      description={
        mode === "sign-in"
          ? "Sign in with the email and password for your team account. Teammates' invites find you by this email."
          : "Create a team account. Teammates' invites find you by this email."
      }
    >
      <form
        className="max-w-md space-y-3 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === "sign-up" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Email</span>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Password</span>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
        </label>
        {authError ? <p className="text-xs text-destructive">{authError}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" size="xs" disabled={!canSubmit}>
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? "Need an account?" : "Have an account?"}
          </Button>
        </div>
      </form>
    </SettingsRow>
  );
}

function MtTeamsSignedInRows() {
  const userName = useMtTeamsSelector((state) => state.userName);
  const me = useMtTeamsSelector((state) => state.me);
  const syncError = useMtTeamsSelector((state) => state.syncError);
  const storeSignOut = useMtTeamsSelector((state) => state.signOut);

  return (
    <>
      <MtTeamsInvitationsRow />
      <SettingsRow
        title="Account"
        description="Signed in to the team service."
        status={
          <span>
            {me?.user.name ?? userName}
            {me?.user.email ? ` · ${me.user.email}` : ""}
          </span>
        }
        control={
          <Button size="xs" variant="outline" onClick={() => void storeSignOut()}>
            Sign out
          </Button>
        }
      />
      {syncError ? (
        <SettingsRow title="Sync" status={<span className="text-destructive">{syncError}</span>} />
      ) : null}
      <MtTeamsTeamsRow />
      <MtTeamsBridgeRow />
      <MtTeamsSharedThreadsRow />
    </>
  );
}

/**
 * Pending invites addressed to the signed-in account's email, with
 * Accept/Decline. Renders nothing when there are none; when there are, it
 * sits at the top of the panel (and the settings nav shows a count badge).
 */
export function MtTeamsInvitationsRow() {
  const myInvites = useMtTeamsSelector((state) => state.myInvites);
  const refreshMe = useMtTeamsSelector((state) => state.refreshMe);
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
      await refreshMe();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPendingInviteId(null);
  };

  return (
    <SettingsRow
      id="mt-teams-invitations"
      title="Invitations"
      description="Teams you have been invited to join."
    >
      <div className="max-w-md space-y-3 pb-2">
        <ul className="space-y-1.5">
          {myInvites.map((invite) => (
            <li
              key={invite.inviteId}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{invite.teamName}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Invited by {invite.invitedByName} · {relativeLabelFromEpochMs(invite.createdAt)}
                </span>
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={pendingInviteId !== null}
                onClick={() => void respond(invite.inviteId, "accept")}
              >
                Accept
              </Button>
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={pendingInviteId !== null}
                onClick={() => void respond(invite.inviteId, "decline")}
              >
                Decline
              </Button>
            </li>
          ))}
        </ul>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}

export function MtTeamsTeamsRow() {
  const me = useMtTeamsSelector((state) => state.me);
  const refreshMe = useMtTeamsSelector((state) => state.refreshMe);
  const [teamName, setTeamName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCreate = async () => {
    if (teamName.trim().length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      await createTeam(getMtTeamsSession(), { name: teamName.trim() });
      setTeamName("");
      await refreshMe();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(false);
  };

  return (
    <SettingsRow
      {...searchableSetting("mt-teams-teams")}
      description="Teammates in a team see each other's shared threads and can message into them. Invite teammates by the email they use for their team account."
    >
      <div className="max-w-md space-y-3 pb-2">
        {me && me.teams.length > 0 ? (
          <ul className="space-y-2">
            {me.teams.map((team) => (
              <MtTeamsTeamCard key={team.id} team={team} meUserId={me.user.id} />
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No teams yet. Create one, or ask a teammate to invite you.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="New team name"
            aria-label="New team name"
          />
          <Button
            size="xs"
            variant="outline"
            disabled={teamName.trim().length === 0 || pending}
            onClick={() => void runCreate()}
          >
            Create
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}

function MtTeamsTeamCard({
  team,
  meUserId,
}: {
  readonly team: MtTeamsTeam;
  readonly meUserId: string;
}) {
  const teamInvites = useMtTeamsSelector((state) => state.teamInvites);
  const refreshMe = useMtTeamsSelector((state) => state.refreshMe);
  const refreshTeamInvites = useMtTeamsSelector((state) => state.refreshTeamInvites);
  const [inviteEmail, setInviteEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      refreshTeamInvites,
    );
    setInviteEmail("");
  };

  return (
    <li className="space-y-2 rounded-md border border-border/60 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {team.name}
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={pending}
          onClick={() =>
            void run(() => leaveTeam(getMtTeamsSession(), { teamId: team.id }), refreshMe)
          }
        >
          Leave team
        </Button>
      </div>
      <ul className="space-y-1">
        {team.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2">
            <InitialsAvatar name={member.name} email={member.email} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {member.name}
              <span className="text-muted-foreground"> · {member.email}</span>
            </span>
            {member.userId !== meUserId ? (
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={pending}
                onClick={() =>
                  void run(
                    () =>
                      removeTeamMember(getMtTeamsSession(), {
                        teamId: team.id,
                        userId: member.userId,
                      }),
                    refreshMe,
                  )
                }
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {invites.length > 0 ? (
        <ul className="space-y-1">
          {invites.map((invite) => (
            <li key={invite.inviteId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {invite.email} · invited by {invite.invitedByName} ·{" "}
                {relativeLabelFromEpochMs(invite.createdAt)}
              </span>
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={pending}
                onClick={() =>
                  void run(
                    () => revokeInvite(getMtTeamsSession(), { inviteId: invite.inviteId }),
                    refreshTeamInvites,
                  )
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runInvite();
        }}
      >
        <Input
          type="email"
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
          placeholder="teammate@example.com"
          aria-label={`Invite to ${team.name} by email`}
          spellCheck={false}
        />
        <Button
          type="submit"
          size="xs"
          variant="outline"
          disabled={inviteEmail.trim().length === 0 || pending}
        >
          Invite
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

function MtTeamsBridgeRow() {
  const refreshMe = useMtTeamsSelector((state) => state.refreshMe);
  const primaryEnvironment = usePrimaryEnvironment();
  const configure = useMtTeamsConfigure();
  const { status, refresh } = useMtTeamsBridgeStatus(primaryEnvironment?.environmentId ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    if (!primaryEnvironment || pending) return;
    setPending(true);
    setError(null);
    try {
      const registered = await registerEnvironment(getMtTeamsSession(), {
        label: primaryEnvironment.label,
      });
      const result = await configure(primaryEnvironment.environmentId, {
        serviceUrl: defaultServiceUrl(),
        environmentKey: registered.environmentKey,
      });
      if (result.ok) {
        refresh();
        void refreshMe();
      } else {
        setError(result.error);
      }
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(false);
  };

  const disable = async () => {
    if (!primaryEnvironment || pending) return;
    setPending(true);
    setError(null);
    const result = await configure(primaryEnvironment.environmentId, {
      serviceUrl: "",
      environmentKey: "",
    });
    if (result.ok) {
      refresh();
    } else {
      setError(result.error);
    }
    setPending(false);
  };

  const statusLine = status
    ? status.configured
      ? `Bridge enabled${status.lastPublishAt ? ` · last publish ${formatRelativeTimeLabel(status.lastPublishAt)}` : " · nothing published yet"}`
      : "Bridge not enabled on this environment."
    : "Bridge status unavailable.";

  return (
    <SettingsRow
      title="This environment"
      description="Registers this environment with the team service and hands its key to the server, which then publishes shared-thread status and delivers teammate messages."
      status={
        <span>
          {statusLine}
          {status?.lastError ? (
            <span className="text-destructive"> · {status.lastError}</span>
          ) : null}
          {error ? <span className="text-destructive"> · {error}</span> : null}
        </span>
      }
      control={
        status?.configured ? (
          <Button
            size="xs"
            variant="outline"
            disabled={pending || !primaryEnvironment}
            onClick={() => void disable()}
          >
            Disable
          </Button>
        ) : (
          <Button
            size="xs"
            variant="outline"
            disabled={pending || !primaryEnvironment}
            onClick={() => void enable()}
          >
            Enable for this environment
          </Button>
        )
      }
    />
  );
}

function MtTeamsSharedThreadsRow() {
  const me = useMtTeamsSelector((state) => state.me);
  const environments = useMtTeamsSelector((state) => state.environments);
  const sharedThreads = useMtTeamsSelector((state) => state.sharedThreads);
  const refreshSharedThreads = useMtTeamsSelector((state) => state.refreshSharedThreads);
  const [teamId, setTeamId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownThreads = me ? sharedThreads.filter((thread) => thread.ownerUserId === me.user.id) : [];
  const teams = me?.teams ?? [];
  const selectedTeam = teams.find((team) => team.id === teamId) ?? teams[0];
  const selectedEnvironment =
    environments.find((environment) => environment.environmentId === environmentId) ??
    environments[0];

  const canShare =
    !pending &&
    selectedTeam !== undefined &&
    selectedEnvironment !== undefined &&
    threadId.trim().length > 0 &&
    title.trim().length > 0;

  const runShare = async () => {
    if (!canShare || !selectedTeam || !selectedEnvironment) return;
    setPending(true);
    setError(null);
    try {
      await shareThread(getMtTeamsSession(), {
        teamId: selectedTeam.id,
        environmentId: selectedEnvironment.environmentId,
        threadId: threadId.trim(),
        title: title.trim(),
      });
      setThreadId("");
      setTitle("");
      await refreshSharedThreads();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(false);
  };

  const runUnshare = async (sharedThreadId: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await unshareThread(getMtTeamsSession(), { sharedThreadId });
      await refreshSharedThreads();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(false);
  };

  return (
    <SettingsRow
      title="Shared threads"
      description="Threads you shared with a team. Teammates see their status and can message into them."
    >
      <div className="max-w-md space-y-3 pb-2">
        {ownThreads.length > 0 ? (
          <ul className="space-y-1.5">
            {ownThreads.map((thread) => (
              <li
                key={thread.sharedThreadId}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {thread.title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {mtTeamsStatusLabel(thread.status)}
                </span>
                <Button
                  size="xs"
                  variant="ghost-muted"
                  disabled={pending}
                  onClick={() => void runUnshare(thread.sharedThreadId)}
                >
                  Unshare
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">Nothing shared yet.</p>
        )}
        {teams.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Select
                value={selectedTeam?.id ?? ""}
                onValueChange={(value) => setTeamId(value ?? "")}
              >
                <SelectTrigger className="w-40" aria-label="Team to share with">
                  <SelectValue>{selectedTeam?.name ?? "Team"}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {teams.map((team) => (
                    <SelectItem hideIndicator key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {environments.length > 1 ? (
                <Select
                  value={selectedEnvironment?.environmentId ?? ""}
                  onValueChange={(value) => setEnvironmentId(value ?? "")}
                >
                  <SelectTrigger className="w-40" aria-label="Environment owning the thread">
                    <SelectValue>{selectedEnvironment?.label ?? "Environment"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {environments.map((environment) => (
                      <SelectItem
                        hideIndicator
                        key={environment.environmentId}
                        value={environment.environmentId}
                      >
                        {environment.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={threadId}
                onChange={(event) => setThreadId(event.target.value)}
                placeholder="Thread ID"
                aria-label="Thread ID"
                spellCheck={false}
              />
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title teammates see"
                aria-label="Shared thread title"
              />
              <Button
                size="xs"
                variant="outline"
                disabled={!canShare}
                onClick={() => void runShare()}
              >
                Share
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A thread's ID is the last segment of its URL. Register this environment above before
              sharing its threads.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Create or join a team to share threads.
          </p>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}
