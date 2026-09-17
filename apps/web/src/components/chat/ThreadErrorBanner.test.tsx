import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  dismissThreadErrorBannerForSession,
  formatThreadErrorClipboardText,
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  showThreadErrorCopyFailure,
  shouldShowThreadErrorBanner,
  ThreadErrorBanner,
} from "./ThreadErrorBanner";
import { anchoredToastManager } from "../ui/toast";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThreadErrorBanner", () => {
  it("stays hidden after its current error is dismissed", () => {
    const bannerKey = getThreadErrorBannerKey("env:thread-a", "Aborted");
    dismissThreadErrorBannerForSession(bannerKey);

    expect(
      shouldShowThreadErrorBanner(
        "env:thread-a",
        "Aborted",
        isThreadErrorBannerDismissedForSession(bannerKey),
      ),
    ).toBe(false);
  });

  it("reappears when a new error arrives on the same thread", () => {
    dismissThreadErrorBannerForSession(getThreadErrorBannerKey("env:thread-b", "Turn failed"));
    const newErrorKey = getThreadErrorBannerKey("env:thread-b", "Provider crashed");

    expect(isThreadErrorBannerDismissedForSession(newErrorKey)).toBe(false);
    expect(
      shouldShowThreadErrorBanner(
        "env:thread-b",
        "Provider crashed",
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

  it("calms a usage-limit failure to a countdown notice instead of the raw error", () => {
    const error = "Your org has used all tokens under the current rate limit";
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        error={error}
        usageLimitResetsAt="2099-01-01T12:00:00.000Z"
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain("Reached your plan&#x27;s usage limit");
    // The countdown owns the whole phrase so a passed window can collapse
    // the preposition without the banner duplicating it.
    expect(markup).toMatch(/<span[^>]*>tokens return in \d+h \d+m<\/span>/);
    expect(markup).not.toContain(error);
    expect(markup).not.toContain('aria-label="Dismiss error"');
  });

  it("shows the raw error again once the limit class clears", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner error="Provider crashed" usageLimitResetsAt={null} />,
    );

    expect(markup).toContain("Provider crashed");
    expect(markup).not.toContain("usage limit");
  });

  it("keeps a passed window grammatical instead of reading 'ready soon'", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        error="Your org has used all tokens under the current rate limit"
        usageLimitResetsAt="2020-01-01T12:00:00.000Z"
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain("tokens return now");
    expect(markup).not.toContain("ready soon");
  });

  it("shows the raw error when the usage-limit class is replaced by another error", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner error="Provider crashed" usageLimitResetsAt={null} />,
    );

    expect(markup).toContain("Provider crashed");
    expect(markup).not.toContain("Reached your plan");
  });
  it("offers copy and aligns the controls with the first line of a multi-line error", () => {
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
    expect(markup).not.toContain("controlAlignment");
    expect(markup).toContain("flex gap-2 items-start");
    expect(markup).toContain("min-h-7 pt-1 sm:min-h-6 sm:pt-0.5");
    expect(markup).toContain("h-lh w-4");
    expect(markup).toContain("h-lh self-start");
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
