import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import {
  applyOptimisticMessageEdit,
  deriveEditableUserMessageId,
  replaceEditableUserText,
  splitEditableUserMessage,
} from "./userMessageEdit";

function messageEntry(
  id: string,
  overrides: Partial<ChatMessage> = {},
): Extract<TimelineEntry, { kind: "message" }> {
  const message: ChatMessage = {
    id: MessageId.make(id),
    role: "user",
    text: `text of ${id}`,
    runId: RunId.make(`run:${id}`),
    streaming: false,
    createdBy: "user",
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    inputIntent: "turn_start",
    ...overrides,
  };
  return { id: message.id, kind: "message", createdAt: message.createdAt, message };
}

describe("splitEditableUserMessage", () => {
  it("edits only what the user typed, keeping the ultrathink prefix and context blocks", () => {
    const text =
      "Ultrathink:\nfix the bug\n\n<terminal_context>\n- Terminal 1:\nls\n</terminal_context>";
    expect(splitEditableUserMessage(text)).toEqual({
      prefix: "Ultrathink:\n",
      editableText: "fix the bug",
      suffix: "\n\n<terminal_context>\n- Terminal 1:\nls\n</terminal_context>",
    });
    expect(replaceEditableUserText(text, "  fix the other bug ")).toBe(
      "Ultrathink:\nfix the other bug\n\n<terminal_context>\n- Terminal 1:\nls\n</terminal_context>",
    );
  });

  it("separates new text from a context block that had no typed text before it", () => {
    const text = "<element_context>\nbutton\n</element_context>";
    expect(splitEditableUserMessage(text).editableText).toBe("");
    expect(replaceEditableUserText(text, "explain this")).toBe(
      "explain this\n\n<element_context>\nbutton\n</element_context>",
    );
  });
});

describe("deriveEditableUserMessageId", () => {
  it("offers the last user message, even after the assistant replied", () => {
    expect(
      deriveEditableUserMessageId([
        messageEntry("first"),
        messageEntry("last"),
        messageEntry("reply", { role: "assistant", createdBy: "agent" }),
      ]),
    ).toBe("last");
  });

  it("offers nothing when the last user message has no run yet or was not typed by the user", () => {
    expect(deriveEditableUserMessageId([messageEntry("pending", { runId: null })])).toBeNull();
    expect(
      deriveEditableUserMessageId([
        messageEntry("first"),
        messageEntry("relay", { createdBy: "agent" }),
      ]),
    ).toBeNull();
    expect(deriveEditableUserMessageId([])).toBeNull();
  });
});

describe("applyOptimisticMessageEdit", () => {
  it("shows the edited text in the original bubble only", () => {
    const entries = [messageEntry("first"), messageEntry("last")];
    expect(applyOptimisticMessageEdit(entries, null)).toBe(entries);
    const edited = applyOptimisticMessageEdit(entries, {
      messageId: MessageId.make("last"),
      text: "edited",
    });
    expect(edited.map((entry) => (entry.kind === "message" ? entry.message.text : null))).toEqual([
      "text of first",
      "edited",
    ]);
    expect(edited[0]).toBe(entries[0]);
  });
});
