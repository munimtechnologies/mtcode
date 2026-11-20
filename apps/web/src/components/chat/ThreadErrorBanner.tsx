import type { OrchestrationV2ProviderFailureClass } from "@t3tools/contracts";
import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_WORKSPACE_ADMIN_REQUEST,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@t3tools/shared/usageLimits";
import { msg, T, useGT } from "gt-react";
import { memo, useRef } from "react";
import { m } from "../../i18n/messages";
import { useCopyToClipboard, writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { anchoredToastManager, toastManager } from "../ui/toast";
import { CheckIcon, CircleAlertIcon, CopyIcon, XIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenAI } from "../Icons";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { ExpandableText } from "../settings/ExpandableText";

const COPY_FEEDBACK_TIMEOUT_MS = 1000;

export function formatThreadErrorClipboardText(input: {
  readonly error: string;
  readonly title?: string | null;
  readonly provider?: string | null;
  readonly threadId?: string | null;
}): string {
  const header: string[] = [];
  const title = input.title?.trim();
  const provider = input.provider?.trim();
  const threadId = input.threadId?.trim();
  if (title) header.push(`Thread: ${title}`);
  if (provider) header.push(`Provider: ${provider}`);
  if (threadId) header.push(`Thread ID: ${threadId}`);
  return header.length === 0 ? input.error : `${header.join("\n")}\n\n${input.error}`;
}

export function showThreadErrorCopyFailure(
  anchor: HTMLButtonElement | null,
  copyError: Error,
): void {
  if (!anchor) return;
  anchoredToastManager.add({
    data: { tooltipStyle: true },
    positionerProps: { anchor },
    timeout: COPY_FEEDBACK_TIMEOUT_MS,
    title: m(msg("Failed to copy")),
    description: copyError.message,
  });
}

function ThreadErrorCopyButton({ clipboardText }: { clipboardText: string }) {
  const gt = useGT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "error message",
      unavailableMessage: msg("Clipboard API is unavailable while copying the error."),
      failureMessage: msg("Failed to copy the error to the clipboard."),
    },
    timeout: COPY_FEEDBACK_TIMEOUT_MS,
    onError: (copyError) => showThreadErrorCopyFailure(buttonRef.current, copyError),
  });
  const copyLabel = isCopied ? gt("Copied error") : gt("Copy error");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={copyLabel}
            onClick={() => copyToClipboard(clipboardText)}
            ref={buttonRef}
            type="button"
          />
        }
      >
        {isCopied ? <CheckIcon className="text-success!" /> : <CopyIcon className="text-error" />}
      </TooltipTrigger>
      <TooltipPopup side="top">{copyLabel}</TooltipPopup>
    </Tooltip>
  );
}

export function copyAdminRequest() {
  void writeTextToClipboard(CHATGPT_WORKSPACE_ADMIN_REQUEST, {
    target: "admin request",
    unavailableMessage: msg("Clipboard API is unavailable while copying admin request."),
    failureMessage: msg("Failed to copy admin request to the clipboard."),
  }).then(
    () =>
      toastManager.add({
        type: "success",
        title: m(msg("Request copied")),
        description: m(msg("Send it to your workspace admin.")),
      }),
    () => toastManager.add({ type: "error", title: m(msg("Could not copy the request")) }),
  );
}

export function getThreadErrorBannerMessage(error: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(error);
  } catch {
    return error;
  }
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return error;
  }
  const nestedError = payload.error;
  if (typeof nestedError !== "object" || nestedError === null || !("message" in nestedError)) {
    return error;
  }
  return typeof nestedError.message === "string" && nestedError.message.trim().length > 0
    ? nestedError.message
    : error;
}

export function getThreadErrorBannerKey(
  threadKey: string,
  error: string | null,
  source: string | null = null,
): string | null {
  return error === null ? null : `${threadKey}\u0000${source ?? ""}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  copyContext,
  onDismiss,
  errorClass,
  errorCode,
}: {
  error: string | null;
  copyContext?: {
    readonly title?: string | null;
    readonly provider?: string | null;
    readonly threadId?: string | null;
  };
  errorClass?: OrchestrationV2ProviderFailureClass | null;
  errorCode?: string | null;
  onDismiss?: () => void;
}) {
  const gt = useGT();
  if (!error) return null;
  const workspaceLimit = errorCode === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  const chatGptLimit = workspaceLimit || errorCode === CHATGPT_USAGE_LIMIT_CODE;
  const variant = errorClass === "usage_limit" || chatGptLimit ? "warning" : "error";
  const clipboardText = formatThreadErrorClipboardText({ error, ...copyContext });
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant={variant} surface="glass" controlAlignment="first-line" data-variant={variant}>
        {chatGptLimit ? (
          <OpenAI className="size-4 text-foreground!" aria-hidden="true" />
        ) : (
          <CircleAlertIcon />
        )}
        <AlertDescription>
          {chatGptLimit ? (
            <div className="space-y-1">
              <p className="font-medium">
                <T>ChatGPT usage limit reached</T>
              </p>
              {workspaceLimit ? (
                <p>
                  {gt(
                    "You've reached your workspace's limit for using your ChatGPT plan in other apps. Copy a request to ask your workspace admin for increased usage limits.",
                  )}
                </p>
              ) : null}
            </div>
          ) : (
            <ExpandableText text={error} collapsedText={getThreadErrorBannerMessage(error)} />
          )}
        </AlertDescription>
        <AlertAction>
          {workspaceLimit ? (
            <Button variant="default" size="sm" onClick={copyAdminRequest}>
              <T>Copy request for admin</T>
            </Button>
          ) : chatGptLimit ? (
            <ChatGptUsageButton variant="default" size="sm" />
          ) : null}
          <ThreadErrorCopyButton clipboardText={clipboardText} />
          {onDismiss ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={gt("Dismiss error")}
              onClick={onDismiss}
            >
              <XIcon />
            </Button>
          ) : null}
        </AlertAction>
      </Alert>
    </div>
  );
});
