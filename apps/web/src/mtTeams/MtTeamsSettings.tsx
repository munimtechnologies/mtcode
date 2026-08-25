/**
 * Settings → General → "MT Teams": sign in to the team service, manage teams,
 * enable the environment bridge, and share/unshare this account's threads.
 * Mounted by SettingsPanels alongside the other General sections; renders the
 * full section whether signed in or out (the sidebar section is the surface
 * that hides while signed out).
 */
import { useState } from "react";
import { UsersIcon } from "lucide-react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
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
import { createTeam, joinTeam, registerEnvironment, shareThread, unshareThread } from "./client";
import { useMtTeamsBridgeStatus, useMtTeamsConfigure } from "./serverRpc";
import { getMtTeamsSession, useMtTeamsSelector, useMtTeamsSync } from "./state";
import { mtTeamsStatusLabel } from "./statusDot";

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The MT Teams request failed.";
}

export function MtTeamsSettings() {
  useMtTeamsSync();
  const serviceUrl = useMtTeamsSelector((state) => state.serviceUrl);
  const setServiceUrl = useMtTeamsSelector((state) => state.setServiceUrl);
  const signedIn = useMtTeamsSelector((state) => state.sessionToken.length > 0);

  return (
    <SettingsSection {...searchableSetting("mt-teams")} icon={<UsersIcon className="size-3.5" />}>
      <SettingsRow
        title="Service URL"
        description="The MT Teams service this client talks to (a Convex HTTP actions origin)."
        control={
          <Input
            value={serviceUrl}
            onChange={(event) => setServiceUrl(event.target.value)}
            placeholder="https://your-deployment.convex.site"
            spellCheck={false}
            aria-label="MT Teams service URL"
          />
        }
      />
      {signedIn ? <MtTeamsSignedInRows /> : <MtTeamsAuthRow />}
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
          ? "Sign in with the email and password for your team service account."
          : "Create an account on the team service."
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

function MtTeamsTeamsRow() {
  const me = useMtTeamsSelector((state) => state.me);
  const refreshMe = useMtTeamsSelector((state) => state.refreshMe);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCreate = async () => {
    if (teamName.trim().length === 0 || pending) return;
    setPending("create");
    setError(null);
    try {
      await createTeam(getMtTeamsSession(), { name: teamName.trim() });
      setTeamName("");
      await refreshMe();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(null);
  };

  const runJoin = async () => {
    if (inviteCode.trim().length === 0 || pending) return;
    setPending("join");
    setError(null);
    try {
      await joinTeam(getMtTeamsSession(), { inviteCode: inviteCode.trim() });
      setInviteCode("");
      await refreshMe();
    } catch (cause) {
      setError(errorText(cause));
    }
    setPending(null);
  };

  return (
    <SettingsRow
      title="Teams"
      description="Teammates in a team see each other's shared threads and can message into them."
    >
      <div className="max-w-md space-y-3 pb-2">
        {me && me.teams.length > 0 ? (
          <ul className="space-y-1.5">
            {me.teams.map((team) => (
              <li
                key={team.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{team.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {team.members.length} {team.members.length === 1 ? "member" : "members"}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {team.inviteCode}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">No teams yet.</p>
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
            disabled={teamName.trim().length === 0 || pending !== null}
            onClick={() => void runCreate()}
          >
            Create
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="Invite code"
            aria-label="Invite code"
            spellCheck={false}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={inviteCode.trim().length === 0 || pending !== null}
            onClick={() => void runJoin()}
          >
            Join
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}

function MtTeamsBridgeRow() {
  const serviceUrl = useMtTeamsSelector((state) => state.serviceUrl);
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
        serviceUrl: serviceUrl.trim(),
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
