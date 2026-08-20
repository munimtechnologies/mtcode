import {
  EventId,
  MessageId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export interface ParsedExternalConversation {
  readonly externalThreadId: string;
  readonly title: string;
  readonly cwd: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly model: string | undefined;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly resumeCursor: unknown;
}

const decodeJsonLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function parseJson(value: string): unknown | undefined {
  return Option.getOrUndefined(decodeJsonLine(value));
}

function field(value: unknown, key: string): unknown {
  return Predicate.isObject(value) ? value[key] : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = field(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const candidate = field(value, key);
  return typeof candidate === "boolean" ? candidate : undefined;
}

function normalizeIso(value: unknown, fallback: string): string {
  const input =
    typeof value === "number" && Number.isFinite(value)
      ? value < 10_000_000_000
        ? value * 1_000
        : value
      : typeof value === "string"
        ? value
        : undefined;
  if (input === undefined) return fallback;
  return Option.match(DateTime.make(input), { onNone: () => fallback, onSome: DateTime.formatIso });
}

function timestampOf(record: unknown, fallback: string): string {
  return normalizeIso(field(record, "timestamp") ?? field(record, "ts"), fallback);
}

function cleanText(value: string): string {
  return value.replaceAll("\u0000", "");
}

function titleFromText(value: string, fallback: string): string {
  const firstLine = cleanText(value).trim().split(/\r?\n/u)[0]?.trim() ?? "";
  if (firstLine.length === 0) return fallback;
  return firstLine.length <= 100 ? firstLine : `${firstLine.slice(0, 99).trimEnd()}…`;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return cleanText(content);
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => stringField(block, "type") === "text")
    .map((block) => stringField(block, "text") ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function classifyTool(toolName: string): {
  readonly itemType: string;
  readonly title: string;
} {
  const normalized = toolName.toLowerCase();
  if (/^(task|agent|subagent)|collab/u.test(normalized)) {
    return { itemType: "collab_agent_tool_call", title: "Subagent task" };
  }
  if (/bash|shell|terminal|command|exec_command|write_stdin/u.test(normalized)) {
    return { itemType: "command_execution", title: "Command run" };
  }
  if (/edit|write|file|patch|replace|create|delete|apply_patch/u.test(normalized)) {
    return { itemType: "file_change", title: "File change" };
  }
  if (/mcp/u.test(normalized)) return { itemType: "mcp_tool_call", title: "MCP tool call" };
  if (/web.?search|web__run/u.test(normalized)) {
    return { itemType: "web_search", title: "Web search" };
  }
  if (/image|view_image/u.test(normalized)) {
    return { itemType: "image_view", title: "Image view" };
  }
  return { itemType: "dynamic_tool_call", title: "Tool call" };
}

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly rawInput?: string;
  readonly nativeCall: unknown;
  readonly turnId: string | null;
  readonly createdAt: string;
  readonly ordinal: number;
}

function commandFromToolInput(value: unknown): string | undefined {
  const candidate = field(value, "command") ?? field(value, "cmd");
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string")) {
    return candidate.join(" ");
  }
  return undefined;
}

function textFromToolResult(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) {
    const parts = value.flatMap((entry) => {
      const text = textFromToolResult(entry, depth + 1);
      return text === undefined ? [] : [text];
    });
    return parts.length === 0 ? undefined : parts.join("\n");
  }
  return (
    textFromToolResult(field(value, "text"), depth + 1) ??
    textFromToolResult(field(value, "output"), depth + 1) ??
    textFromToolResult(field(value, "content"), depth + 1)
  );
}

function toolDetail(call: ToolCall): string | undefined {
  const command = commandFromToolInput(call.input);
  if (command?.trim()) return `${call.name}: ${command.trim()}`;
  try {
    const serialized = JSON.stringify(call.input);
    if (!serialized || serialized === "{}" || serialized === "null") return undefined;
    return `${call.name}: ${serialized.length <= 400 ? serialized : `${serialized.slice(0, 397)}...`}`;
  } catch {
    return call.name;
  }
}

function toolActivity(input: {
  readonly provider: "claude" | "codex";
  readonly conversationId: string;
  readonly call: ToolCall;
  readonly nativeResult?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
  readonly createdAt?: string;
}): OrchestrationThreadActivity {
  const presentation = classifyTool(input.call.name);
  const completed = input.nativeResult !== undefined;
  const command = commandFromToolInput(input.call.input);
  const output = completed ? textFromToolResult(input.result) : undefined;
  const detail = toolDetail(input.call);
  return {
    id: EventId.make(
      `import:${input.provider}:${input.conversationId}:tool:${input.call.id}:${input.call.ordinal}`,
    ),
    tone: input.isError ? "error" : "tool",
    kind: completed ? "tool.completed" : "tool.started",
    summary: presentation.title,
    payload: {
      itemType: presentation.itemType,
      status: input.isError ? "failed" : completed ? "completed" : "inProgress",
      title: presentation.title,
      ...(detail === undefined ? {} : { detail }),
      data: {
        toolCallId: input.call.id,
        toolName: input.call.name,
        input: input.call.input,
        ...(command === undefined ? {} : { command }),
        ...(input.call.rawInput === undefined ? {} : { rawInput: input.call.rawInput }),
        ...(completed ? { result: input.result } : {}),
        ...(output === undefined ? {} : { output }),
        native: {
          call: input.call.nativeCall,
          ...(completed ? { result: input.nativeResult } : {}),
        },
      },
    },
    turnId: input.call.turnId === null ? null : TurnId.make(input.call.turnId),
    sequence: input.call.ordinal,
    createdAt: input.createdAt ?? input.call.createdAt,
  };
}

function parsedLines(transcript: string): ReadonlyArray<unknown> {
  return transcript
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map(parseJson)
    .filter((record): record is unknown => record !== undefined);
}

function defaultTimestamp(): string {
  return "1970-01-01T00:00:00.000Z";
}

export function parseClaudeTranscript(
  transcript: string,
  expectedSessionId?: string,
): ParsedExternalConversation | undefined {
  const records = parsedLines(transcript);
  const messageRecords = records.filter((record) => {
    const type = stringField(record, "type");
    return (
      (type === "user" || type === "assistant") &&
      typeof stringField(record, "uuid") === "string" &&
      booleanField(record, "isSidechain") !== true
    );
  });
  if (messageRecords.length === 0) return undefined;

  const sessionId =
    expectedSessionId ??
    messageRecords.map((record) => stringField(record, "sessionId")).find(Boolean);
  if (!sessionId) return undefined;

  const byUuid = new Map(
    messageRecords.map((record) => [stringField(record, "uuid") as string, record] as const),
  );
  const branch: unknown[] = [];
  const visited = new Set<string>();
  let cursor: unknown | undefined = messageRecords.at(-1);
  while (cursor !== undefined) {
    const uuid = stringField(cursor, "uuid");
    if (!uuid || visited.has(uuid)) break;
    visited.add(uuid);
    branch.push(cursor);
    const parentUuid = stringField(cursor, "parentUuid");
    cursor = parentUuid ? byUuid.get(parentUuid) : undefined;
  }
  branch.reverse();

  const fallback = defaultTimestamp();
  const createdAt = timestampOf(branch[0], fallback);
  const updatedAt = timestampOf(branch.at(-1), createdAt);
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  const calls = new Map<string, ToolCall>();
  const resumePoints: Array<{ turnId: string; resumeSessionAt: string }> = [];
  let currentTurnId: string | null = null;
  let lastAssistantUuid: string | undefined;
  let model: string | undefined;
  let ordinal = 0;

  for (const record of branch) {
    ordinal += 1;
    const type = stringField(record, "type");
    const uuid = stringField(record, "uuid") ?? `${ordinal}`;
    const message = field(record, "message");
    const content = field(message, "content");
    const created = timestampOf(record, createdAt);

    if (type === "user") {
      const text = messageText(content);
      const toolResults = Array.isArray(content)
        ? content.filter((block) => stringField(block, "type") === "tool_result")
        : [];
      if (text.trim().length > 0) {
        currentTurnId = `import:claude:${sessionId}:turn:${uuid}`;
        messages.push({
          id: MessageId.make(`import:claude:${sessionId}:message:${uuid}`),
          role: "user",
          text,
          turnId: TurnId.make(currentTurnId),
          streaming: false,
          createdAt: created,
          updatedAt: created,
        });
      }
      for (const resultBlock of toolResults) {
        const callId = stringField(resultBlock, "tool_use_id");
        if (!callId) continue;
        const call = calls.get(callId);
        if (!call) continue;
        activities.push(
          toolActivity({
            provider: "claude",
            conversationId: sessionId,
            call,
            nativeResult: resultBlock,
            result: field(resultBlock, "content"),
            isError: booleanField(resultBlock, "is_error") === true,
            createdAt: created,
          }),
        );
        calls.delete(callId);
      }
      continue;
    }

    if (type !== "assistant") continue;
    const assistantText = messageText(content);
    model = stringField(message, "model") ?? model;
    lastAssistantUuid = uuid;
    if (currentTurnId !== null) {
      const previous = resumePoints.at(-1);
      if (previous?.turnId === currentTurnId) {
        resumePoints[resumePoints.length - 1] = {
          turnId: currentTurnId,
          resumeSessionAt: uuid,
        };
      } else {
        resumePoints.push({ turnId: currentTurnId, resumeSessionAt: uuid });
      }
    }
    if (assistantText.length > 0) {
      messages.push({
        id: MessageId.make(`import:claude:${sessionId}:message:${uuid}`),
        role: "assistant",
        text: assistantText,
        turnId: currentTurnId === null ? null : TurnId.make(currentTurnId),
        streaming: false,
        createdAt: created,
        updatedAt: created,
      });
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (stringField(block, "type") !== "tool_use") continue;
      const callId = stringField(block, "id");
      const name = stringField(block, "name");
      if (!callId || !name) continue;
      calls.set(callId, {
        id: callId,
        name,
        input: field(block, "input"),
        nativeCall: block,
        turnId: currentTurnId,
        createdAt: created,
        ordinal,
      });
    }
  }
  for (const call of calls.values()) {
    activities.push(toolActivity({ provider: "claude", conversationId: sessionId, call }));
  }

  const firstUser =
    messages.find((message) => message.role === "user")?.text ?? "Claude conversation";
  const aiTitle = records
    .filter((record) => stringField(record, "type") === "ai-title")
    .map((record) => stringField(record, "aiTitle"))
    .find((candidate) => candidate && candidate.trim().length > 0);
  return {
    externalThreadId: sessionId,
    title: aiTitle?.trim() ?? titleFromText(firstUser, "Claude conversation"),
    cwd: branch.map((record) => stringField(record, "cwd")).find(Boolean),
    createdAt,
    updatedAt,
    model,
    messages,
    activities,
    resumeCursor: {
      resume: sessionId,
      ...(lastAssistantUuid === undefined ? {} : { resumeSessionAt: lastAssistantUuid }),
      turnCount: resumePoints.length,
      resumePoints,
    },
  };
}

function decodeToolInput(value: unknown): { readonly input: unknown; readonly rawInput?: string } {
  if (typeof value !== "string") return { input: value };
  return { input: parseJson(value) ?? value, rawInput: value };
}

function codexToolName(itemType: string, payload: unknown): string {
  return stringField(payload, "name") ?? itemType.replace(/_output$/u, "");
}

function codexToolResult(payload: unknown): unknown {
  return (
    field(payload, "output") ??
    field(payload, "result") ??
    field(payload, "tools") ??
    field(payload, "execution") ??
    payload
  );
}

function codexToolFailed(payload: unknown): boolean {
  const status = stringField(payload, "status")?.toLocaleLowerCase();
  return status === "failed" || status === "error" || status === "cancelled";
}

function codexToolStillRunning(payload: unknown): boolean {
  const status = stringField(payload, "status")?.toLocaleLowerCase();
  return (
    status === "in_progress" || status === "pending" || status === "running" || status === "started"
  );
}

export function parseCodexTranscript(
  transcript: string,
  expectedThreadId?: string,
): ParsedExternalConversation | undefined {
  const records = parsedLines(transcript);
  const meta = records.find((record) => stringField(record, "type") === "session_meta");
  const metaPayload = field(meta, "payload");
  const externalThreadId = expectedThreadId ?? stringField(metaPayload, "id");
  if (!externalThreadId) return undefined;

  const fallback = defaultTimestamp();
  const createdAt = timestampOf(meta, fallback);
  let updatedAt = createdAt;
  let cwd = stringField(metaPayload, "cwd");
  let model: string | undefined;
  let currentTurnId: string | null = null;
  let currentTurnIdIsNative = false;
  let currentTurnHasUser = false;
  let ordinal = 0;
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  const calls = new Map<string, ToolCall>();

  for (const record of records) {
    ordinal += 1;
    const created = timestampOf(record, updatedAt);
    updatedAt = created;
    const type = stringField(record, "type");
    const payload = field(record, "payload");
    if (type === "turn_context") {
      const nativeTurnId = stringField(payload, "turn_id");
      currentTurnId = nativeTurnId ?? null;
      currentTurnIdIsNative = nativeTurnId !== undefined;
      currentTurnHasUser = false;
      model = stringField(payload, "model") ?? model;
      cwd = stringField(payload, "cwd") ?? cwd;
      continue;
    }
    if (type === "event_msg") {
      const eventType = stringField(payload, "type");
      if (eventType === "task_started") {
        const nativeTurnId = stringField(payload, "turn_id");
        if (nativeTurnId !== undefined) {
          currentTurnId = nativeTurnId;
          currentTurnIdIsNative = true;
          currentTurnHasUser = false;
        }
        continue;
      }
      const role =
        eventType === "user_message"
          ? "user"
          : eventType === "agent_message"
            ? "assistant"
            : undefined;
      const text = stringField(payload, "message");
      if (role && text !== undefined) {
        const nativeId = stringField(payload, "id") ?? `${ordinal}`;
        if (role === "user") {
          if (currentTurnId === null || (!currentTurnIdIsNative && currentTurnHasUser)) {
            currentTurnId = `import:codex:${externalThreadId}:turn:${nativeId}:${ordinal}`;
            currentTurnIdIsNative = false;
          }
          currentTurnHasUser = true;
        }
        messages.push({
          id: MessageId.make(`import:codex:${externalThreadId}:message:${nativeId}:${ordinal}`),
          role,
          text: cleanText(text),
          turnId: currentTurnId === null ? null : TurnId.make(currentTurnId),
          streaming: false,
          createdAt: created,
          updatedAt: created,
        });
      }
      continue;
    }
    if (type !== "response_item") continue;
    const itemType = stringField(payload, "type");
    if (!itemType) continue;
    if (
      itemType === "function_call" ||
      itemType === "custom_tool_call" ||
      itemType === "tool_search_call"
    ) {
      const callId = stringField(payload, "call_id");
      const name = codexToolName(itemType, payload);
      if (!callId || !name) continue;
      const raw =
        itemType === "custom_tool_call" ? field(payload, "input") : field(payload, "arguments");
      const decoded = decodeToolInput(raw);
      calls.set(callId, {
        id: callId,
        name,
        input: decoded.input,
        ...(decoded.rawInput === undefined ? {} : { rawInput: decoded.rawInput }),
        nativeCall: payload,
        turnId: currentTurnId,
        createdAt: created,
        ordinal,
      });
      continue;
    }
    if (itemType === "tool_search_output" || itemType.endsWith("_call_output")) {
      const callId = stringField(payload, "call_id") ?? stringField(payload, "id") ?? `${ordinal}`;
      const call =
        calls.get(callId) ??
        ({
          id: callId,
          name: codexToolName(itemType, payload),
          input: null,
          nativeCall: null,
          turnId: currentTurnId,
          createdAt: created,
          ordinal,
        } satisfies ToolCall);
      activities.push(
        toolActivity({
          provider: "codex",
          conversationId: externalThreadId,
          call,
          nativeResult: payload,
          result: codexToolResult(payload),
          isError: codexToolFailed(payload),
          createdAt: created,
        }),
      );
      calls.delete(callId);
      continue;
    }
    if (itemType.endsWith("_call")) {
      const callId =
        stringField(payload, "call_id") ?? stringField(payload, "id") ?? `${itemType}:${ordinal}`;
      const raw =
        field(payload, "arguments") ??
        field(payload, "input") ??
        field(payload, "action") ??
        field(payload, "prompt") ??
        null;
      const decoded = decodeToolInput(raw);
      const call: ToolCall = {
        id: callId,
        name: codexToolName(itemType, payload),
        input: decoded.input,
        ...(decoded.rawInput === undefined ? {} : { rawInput: decoded.rawInput }),
        nativeCall: payload,
        turnId: currentTurnId,
        createdAt: created,
        ordinal,
      };
      activities.push(
        codexToolStillRunning(payload)
          ? toolActivity({ provider: "codex", conversationId: externalThreadId, call })
          : toolActivity({
              provider: "codex",
              conversationId: externalThreadId,
              call,
              nativeResult: payload,
              result: codexToolResult(payload),
              isError: codexToolFailed(payload),
              createdAt: created,
            }),
      );
    }
  }
  for (const call of calls.values()) {
    activities.push(toolActivity({ provider: "codex", conversationId: externalThreadId, call }));
  }

  if (messages.length === 0 && activities.length === 0) return undefined;
  const firstUser =
    messages.find((message) => message.role === "user")?.text ?? "Codex conversation";
  return {
    externalThreadId,
    title: titleFromText(firstUser, "Codex conversation"),
    cwd,
    createdAt,
    updatedAt,
    model,
    messages,
    activities,
    resumeCursor: { threadId: externalThreadId },
  };
}
