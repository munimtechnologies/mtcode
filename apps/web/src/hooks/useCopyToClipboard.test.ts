import type { Dispatch, SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { COMPOSER_CONTEXT_CLIPBOARD_MIME } from "@t3tools/shared/composerContextClipboard";

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let slots: unknown[] = [];

  const nextIndex = () => cursor++;
  const unmount = () => {
    for (const slot of slots) {
      if (
        typeof slot === "object" &&
        slot !== null &&
        "effectCleanup" in slot &&
        typeof slot.effectCleanup === "function"
      ) {
        slot.effectCleanup();
        slot.effectCleanup = undefined;
      }
    }
  };

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      unmount();
      cursor = 0;
      slots = [];
    },
    unmount,
    useCallback<T>(callback: T): T {
      nextIndex();
      return callback;
    },
    useEffect(effect: () => void | (() => void)): void {
      const index = nextIndex();
      if (slots[index] === undefined) {
        slots[index] = { effectCleanup: effect() };
      }
    },
    // Layout effects without deps run on every render (useStableCallback relies on this).
    useLayoutEffect(effect: () => void | (() => void)): void {
      nextIndex();
      effect();
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = nextIndex();
      if (slots[index] === undefined) {
        slots[index] = { current: initialValue };
      }
      return slots[index] as { current: T };
    },
    useState<T>(initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
      const index = nextIndex();
      if (slots[index] === undefined) {
        slots[index] =
          typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
      }
      const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
        const previous = slots[index] as T;
        slots[index] =
          typeof nextValue === "function" ? (nextValue as (value: T) => T)(previous) : nextValue;
      };
      return [slots[index] as T, setValue];
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useLayoutEffect: hooks.useLayoutEffect,
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

import { useCopyToClipboard, writeTextToClipboard } from "./useCopyToClipboard";

async function flushClipboardWrite(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  hooks.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("writeTextToClipboard", () => {
  it("reserves plain text even when an extra flavor attempts to replace it", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly data: Record<string, Blob>) {}
      },
    );
    await expect(
      writeTextToClipboard("original", "message", {
        "text/plain": "replacement",
        "text/html": "<b>original</b>",
      }),
    ).resolves.toBe(true);
    const items = write.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>;
    expect(await items[0]!.data["text/plain"]!.text()).toBe("original");
  });

  it("keeps caller-built rich HTML when attaching a context fragment", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly data: Record<string, Blob>) {}
      },
    );
    const fragment = JSON.stringify({ version: 1, source: {}, records: [] });
    const rich = "<p><strong>Message</strong></p>";

    await expect(
      writeTextToClipboard("Message", "message", {
        [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment,
        "text/html": rich,
      }),
    ).resolves.toBe(true);

    const items = write.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>;
    const html = await items[0]!.data["text/html"]!.text();
    expect(html).toContain(rich);
    expect(html).toContain("data-t3-context-fragment=");
  });

  it.each([true, false])(
    "keeps empty values as a no-op with Clipboard API support: %s",
    async (available) => {
      const writeText = vi.fn();
      vi.stubGlobal("window", {});
      const execCommand = vi.fn();
      vi.stubGlobal("navigator", available ? { clipboard: { writeText } } : {});
      vi.stubGlobal("document", { execCommand });

      await expect(writeTextToClipboard("", "plan")).resolves.toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      expect(execCommand).not.toHaveBeenCalled();
    },
  );

  it("writes the complete multiline value without transforming it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const diagnostic = "Provider failed\ncaused by: socket closed\nrequest id: abc-123";

    await expect(writeTextToClipboard(diagnostic, "error-message")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith(diagnostic);
  });
});

describe("useCopyToClipboard", () => {
  it("shows copied state only after success and resets it after the timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onCopy = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const options = { timeout: 1000, onCopy };

    hooks.beginRender();
    const initial = useCopyToClipboard<string>(options);
    initial.copyToClipboard("complete diagnostic", "thread-a");
    await flushClipboardWrite();

    hooks.beginRender();
    expect(useCopyToClipboard<string>(options).isCopied).toBe(true);
    expect(onCopy).toHaveBeenCalledWith("thread-a");

    vi.advanceTimersByTime(1000);
    hooks.beginRender();
    expect(useCopyToClipboard<string>(options).isCopied).toBe(false);
  });

  it("clears copied feedback when a repeat attempt fails", async () => {
    vi.useFakeTimers();
    const cause = new Error("clipboard permission revoked");
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(cause);
    const onError = vi.fn();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const options = { timeout: 1000, target: "error-message", onError };

    hooks.beginRender();
    let current = useCopyToClipboard<string>(options);
    current.copyToClipboard("first diagnostic", "thread-a");
    await flushClipboardWrite();

    hooks.beginRender();
    current = useCopyToClipboard<string>(options);
    expect(current.isCopied).toBe(true);
    current.copyToClipboard("second diagnostic", "thread-a");

    hooks.beginRender();
    expect(useCopyToClipboard<string>(options).isCopied).toBe(false);
    await flushClipboardWrite();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ cause, target: "error-message" }),
      "thread-a",
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores stale completions from an earlier copy attempt", async () => {
    let resolveFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    });
    const writeText = vi.fn().mockReturnValueOnce(firstWrite).mockResolvedValueOnce(undefined);
    const onCopy = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const options = { timeout: 0, onCopy };

    hooks.beginRender();
    const current = useCopyToClipboard<string>(options);
    current.copyToClipboard("older diagnostic", "older");
    current.copyToClipboard("newer diagnostic", "newer");
    await flushClipboardWrite();

    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledWith("newer");

    resolveFirstWrite();
    await flushClipboardWrite();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("ignores a pending clipboard completion after unmount", async () => {
    vi.useFakeTimers();
    let resolveWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const writeText = vi.fn().mockReturnValue(pendingWrite);
    const onCopy = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    hooks.beginRender();
    const current = useCopyToClipboard<void>({ onCopy });
    current.copyToClipboard("diagnostic");
    hooks.unmount();
    resolveWrite();
    await flushClipboardWrite();

    expect(onCopy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
