import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  dismissThreadErrorBannerForSession,
  formatThreadErrorClipboardText,
  getThreadErrorBannerKey,
  getThreadErrorBannerMessage,
  isThreadErrorBannerDismissedForSession,
  showThreadErrorCopyFailure,
  shouldShowThreadErrorBanner,
  ThreadErrorBanner,
} from "./ThreadErrorBanner";
import { anchoredToastManager } from "../ui/toast";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getThreadErrorBannerMessage", () => {
  it("extracts a readable nested message without trimming its whitespace", () => {
    const message =
      "  This model is not supported with a ChatGPT account.\nChoose another model.  ";
    const error = ` \n${JSON.stringify({ error: { message, code: "unsupported_model" } })}\t `;

    expect(getThreadErrorBannerMessage(error)).toBe(message);
  });

  it("keeps the diagnostics when the nested message is blank", () => {
    const error = JSON.stringify({ error: { message: " \n\t ", code: "unsupported_model" } });

    expect(getThreadErrorBannerMessage(error)).toBe(error);
  });
});

describe("ThreadErrorBanner", () => {
  it("reappears for different diagnostics with the same headline on the same thread", () => {
    const firstError = JSON.stringify({ error: { message: "Turn failed", code: "first" } });
    const secondError = JSON.stringify({ error: { message: "Turn failed", code: "second" } });
    const dismissedKey = getThreadErrorBannerKey("env:thread-b", firstError);
    dismissThreadErrorBannerForSession(dismissedKey);
    const newErrorKey = getThreadErrorBannerKey("env:thread-b", secondError);

    expect(isThreadErrorBannerDismissedForSession(dismissedKey)).toBe(true);
    expect(isThreadErrorBannerDismissedForSession(newErrorKey)).toBe(false);
    expect(
      shouldShowThreadErrorBanner(
        "env:thread-b",
        secondError,
        isThreadErrorBannerDismissedForSession(newErrorKey),
      ),
    ).toBe(true);
  });

  it("scopes dismissals to the thread that dismissed them", () => {
    dismissThreadErrorBannerForSession(getThreadErrorBannerKey("env:thread-c", "Aborted"));
    const otherThreadKey = getThreadErrorBannerKey("env:other-thread", "Aborted");

    expect(isThreadErrorBannerDismissedForSession(otherThreadKey)).toBe(false);
    expect(
      shouldShowThreadErrorBanner(
        "env:other-thread",
        "Aborted",
        isThreadErrorBannerDismissedForSession(otherThreadKey),
      ),
    ).toBe(true);
  });

  it("gives identical diagnostics on different threads distinct render identities", () => {
    expect(getThreadErrorBannerKey("env:thread-c", "Aborted")).not.toBe(
      getThreadErrorBannerKey("env:other-thread", "Aborted"),
    );
  });

  it("keeps a dismissal across visiting threads with no error", () => {
    const bannerKey = getThreadErrorBannerKey("env:thread-d", "Aborted");
    dismissThreadErrorBannerForSession(bannerKey);

    expect(shouldShowThreadErrorBanner("env:thread-d", null, false)).toBe(false);
    expect(isThreadErrorBannerDismissedForSession(bannerKey)).toBe(true);
    expect(
      shouldShowThreadErrorBanner(
        "env:thread-d",
        "Aborted",
        isThreadErrorBannerDismissedForSession(bannerKey),
      ),
    ).toBe(false);
  });

  it("never shows a null error", () => {
    expect(shouldShowThreadErrorBanner("env:thread-e", null, false)).toBe(false);
  });

  it("offers copy next to dismiss on a multi-line error", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        error={"The first error line\ncontinues on a second line"}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Copy error"');
    expect(markup).toContain("lucide-copy text-error");
    expect(markup).toContain('aria-label="Dismiss error"');
  });

  it("shows anchored feedback when copying fails", () => {
    const addToast = vi
      .spyOn(anchoredToastManager, "add")
      .mockImplementation(() => undefined as never);
    const anchor = {} as HTMLButtonElement;

    showThreadErrorCopyFailure(anchor, new Error("Clipboard access was denied."));

    expect(addToast).toHaveBeenCalledWith({
      data: { tooltipStyle: true },
      positionerProps: { anchor },
      timeout: 1000,
      title: "Failed to copy",
      description: "Clipboard access was denied.",
    });
  });
});

describe("formatThreadErrorClipboardText", () => {
  it("copies the error alone when there is no thread context", () => {
    expect(formatThreadErrorClipboardText({ error: "Aborted" })).toBe("Aborted");
  });

  it("prefixes title, provider, and thread id for paste into a report", () => {
    expect(
      formatThreadErrorClipboardText({
        error: "Provider crashed",
        title: "Fix sidebar search",
        provider: "Claude Code",
        threadId: "thread-123",
      }),
    ).toBe(
      "Thread: Fix sidebar search\nProvider: Claude Code\nThread ID: thread-123\n\nProvider crashed",
    );
  });
});
