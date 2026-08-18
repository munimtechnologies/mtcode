"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  EnvironmentId,
  ProviderAccountLoginMode,
  ProviderInstanceId,
  ServerProviderAccountLogin,
} from "@t3tools/contracts";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import {
  apiKeyHint,
  phaseForLoginEvent,
  signInAccountLabel,
  type SignInPhase,
} from "./ProviderAccountSignIn.logic";

interface ProviderAccountSignInProps {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly driver: string;
  readonly accountLogin: ServerProviderAccountLogin;
  readonly onComplete?: (() => void) | undefined;
  /**
   * Extra idle-state actions rendered next to Sign in / device code / API key
   * (for example "Add account" on a provider card).
   */
  readonly trailingActions?: ReactNode | undefined;
}

/**
 * Interactive account sign-in, shared by the provider card and the
 * add-account wizard. Drives `server.loginProviderAccount` and renders each
 * phase of the exchange: browser link, device code, or paste-back code.
 */
export function ProviderAccountSignIn({
  environmentId,
  instanceId,
  driver,
  accountLogin,
  onComplete,
  trailingActions,
}: ProviderAccountSignInProps) {
  const [phase, setPhase] = useState<SignInPhase>({ status: "idle" });
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loginProviderAccount = useAtomCommand(serverEnvironment.loginProviderAccount, {
    reportFailure: false,
    reportDefect: false,
  });
  const submitProviderLoginCode = useAtomCommand(serverEnvironment.submitProviderLoginCode, {
    reportFailure: false,
    reportDefect: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });

  // Abort any in-flight login when this instance's sign-in UI unmounts —
  // the server tears down the CLI process behind the flow.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () => {
      toastManager.add({ type: "success", title: "Copied" });
    },
  });

  const accountLabel = signInAccountLabel(driver);
  const keyHint = apiKeyHint(driver);
  const busy =
    phase.status === "starting" ||
    phase.status === "authUrl" ||
    phase.status === "deviceCode" ||
    phase.status === "awaitingCode";

  const startLogin = async (mode: ProviderAccountLoginMode, apiKey?: string) => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setPhase({ status: "starting" });
    const result = await loginProviderAccount({
      environmentId,
      input: {
        instanceId,
        mode,
        ...(apiKey !== undefined ? { apiKey } : {}),
      },
      onEvent: (event) => {
        setPhase(phaseForLoginEvent(event));
      },
      abortSignal: abortController.signal,
    });
    if (abortController.signal.aborted) {
      return;
    }
    if (result._tag === "Success") {
      // The stream can end without a `complete` event only on cancellation;
      // reaching here with an interactive phase still shown means success.
      setPhase({ status: "succeeded" });
      setApiKeyDraft("");
      void refreshProviders({ environmentId, input: { instanceId } });
      onComplete?.();
      return;
    }
    const message =
      typeof result.error === "object" && result.error !== null && "message" in result.error
        ? String((result.error as { message: unknown }).message)
        : "Sign-in failed.";
    setPhase({ status: "failed", message });
  };

  const cancelLogin = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ status: "idle" });
  };

  const submitCode = async () => {
    const code = codeDraft.trim();
    if (code.length === 0 || phase.status !== "awaitingCode") return;
    setPhase({ ...phase, codeSubmitted: true });
    const result = await submitProviderLoginCode({
      environmentId,
      input: { instanceId, code },
    });
    if (result._tag !== "Success") {
      setPhase({ ...phase, codeSubmitted: false });
      toastManager.add({
        type: "error",
        title: "Could not submit the code",
        description:
          typeof result.error === "object" && result.error !== null && "message" in result.error
            ? String((result.error as { message: unknown }).message)
            : "Try again.",
      });
      return;
    }
    setCodeDraft("");
  };

  const openLinkNode = (url: string, label: string) => (
    <div className="flex min-w-0 items-center gap-1.5">
      <Button
        size="xs"
        variant="default"
        render={<a href={url} target="_blank" rel="noreferrer" />}
      >
        <ExternalLinkIcon className="size-3" />
        {label}
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="size-6 shrink-0 rounded-sm p-0 text-muted-foreground hover:text-foreground"
        onClick={() => copyToClipboard(url, {})}
        aria-label="Copy sign-in link"
      >
        <CopyIcon className="size-3" />
      </Button>
    </div>
  );

  if (phase.status === "succeeded") {
    return (
      <div className="flex items-center gap-1.5 text-[13px] text-success">
        <CheckIcon className="size-3.5" aria-hidden />
        <span>Signed in. Refreshing account details…</span>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {phase.status === "idle" || phase.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {accountLogin.modes.includes("oauth") ? (
            <Button
              type="button"
              size="xs"
              variant="default"
              onClick={() => void startLogin("oauth")}
            >
              Sign in with {accountLabel}
            </Button>
          ) : null}
          {accountLogin.modes.includes("deviceCode") ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void startLogin("deviceCode")}
            >
              Use device code
            </Button>
          ) : null}
          {accountLogin.modes.includes("apiKey") ? (
            <Button
              type="button"
              size="xs"
              variant={showApiKey ? "secondary" : "outline"}
              onClick={() => setShowApiKey((current) => !current)}
            >
              <KeyRoundIcon className="size-3" />
              Use API key
            </Button>
          ) : null}
          {trailingActions}
        </div>
      ) : null}

      {phase.status === "failed" ? (
        <p className="text-[12px] leading-snug text-destructive">{phase.message}</p>
      ) : null}

      {(phase.status === "idle" || phase.status === "failed") && showApiKey ? (
        <div className="grid max-w-md gap-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              type="password"
              className="h-7 bg-background text-[13px]"
              placeholder={keyHint.placeholder}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              aria-label="API key"
            />
            <Button
              type="button"
              size="xs"
              variant="default"
              disabled={apiKeyDraft.trim().length === 0}
              onClick={() => void startLogin("apiKey", apiKeyDraft.trim())}
            >
              Save
            </Button>
          </div>
          <span className="text-[11px] text-muted-foreground">{keyHint.description}</span>
        </div>
      ) : null}

      {busy ? (
        <div className="grid gap-2">
          {phase.status === "starting" ? (
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
              <span>Starting sign-in…</span>
            </div>
          ) : null}
          {phase.status === "authUrl" ? (
            <div className="grid gap-1.5">
              <p className="text-[13px] text-muted-foreground">
                Finish signing in to {accountLabel} in your browser. This completes on its own.
              </p>
              {openLinkNode(phase.url, "Open sign-in page")}
            </div>
          ) : null}
          {phase.status === "deviceCode" ? (
            <div className="grid gap-1.5">
              <p className="text-[13px] text-muted-foreground">
                Open the link on any device and enter this code:
              </p>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted/60 px-2 py-1 font-mono text-sm tracking-[0.2em] text-foreground">
                  {phase.userCode}
                </code>
                {openLinkNode(phase.url, "Open verification page")}
              </div>
            </div>
          ) : null}
          {phase.status === "awaitingCode" ? (
            <div className="grid max-w-md gap-1.5">
              <p className="text-[13px] text-muted-foreground">
                Authorize in the browser, then paste the code it gives you here.
              </p>
              {openLinkNode(phase.url, "Open sign-in page")}
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-7 bg-background font-mono text-[13px]"
                  placeholder="Paste authorization code"
                  value={codeDraft}
                  onChange={(event) => setCodeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitCode();
                  }}
                  disabled={phase.codeSubmitted}
                  aria-label="Authorization code"
                />
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  disabled={codeDraft.trim().length === 0 || phase.codeSubmitted}
                  onClick={() => void submitCode()}
                >
                  {phase.codeSubmitted ? <LoaderIcon className="size-3 animate-spin" /> : null}
                  Submit
                </Button>
              </div>
            </div>
          ) : null}
          <div>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className={cn("text-muted-foreground")}
              onClick={cancelLogin}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
