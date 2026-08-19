/**
 * Public Docs: https://cursor.com/docs/cli/acp#cursor-extension-methods
 * Additional reference provided by the Cursor team: https://anysphere.enterprise.slack.com/files/U068SSJE141/F0APT1HSZRP/cursor-acp-extension-method-schemas.md
 */
import type { ProviderUserInputAnswers, UserInputQuestion } from "@t3tools/contracts";
import * as AcpSchema from "effect-acp/schema";
import * as Schema from "effect/Schema";

const CursorAskQuestionOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const CursorAskQuestion = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  options: Schema.Array(CursorAskQuestionOption),
  allowMultiple: Schema.optional(Schema.Boolean),
});

export const CursorAskQuestionRequest = Schema.Struct({
  toolCallId: Schema.String,
  title: Schema.optional(Schema.String),
  questions: Schema.Array(CursorAskQuestion),
});

const CursorTodoStatus = Schema.String;

const CursorTodo = Schema.Struct({
  id: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  status: Schema.optional(CursorTodoStatus),
});

const CursorPlanPhase = Schema.Struct({
  name: Schema.String,
  todos: Schema.Array(CursorTodo),
});

export const CursorCreatePlanRequest = Schema.Struct({
  toolCallId: Schema.String,
  name: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  plan: Schema.String,
  todos: Schema.Array(CursorTodo),
  isProject: Schema.optional(Schema.Boolean),
  phases: Schema.optional(Schema.Array(CursorPlanPhase)),
});

export const CursorUpdateTodosRequest = Schema.Struct({
  toolCallId: Schema.String,
  todos: Schema.Array(CursorTodo),
  merge: Schema.Boolean,
});

const CursorAvailableModel = Schema.Struct({
  value: Schema.String,
  name: Schema.String,
  configOptions: Schema.optional(Schema.Array(AcpSchema.SessionConfigOption)),
});

export const CursorListAvailableModelsResponse = Schema.Struct({
  models: Schema.Array(CursorAvailableModel),
});

const CursorNamedSubagentType = Schema.Literals([
  "unspecified",
  "computer_use",
  "explore",
  "video_review",
  "browser_use",
  "shell",
  "vm_setup_helper",
]);

const CursorCustomSubagentType = Schema.Struct({
  custom: Schema.String,
});

export const CursorTaskRequest = Schema.Struct({
  toolCallId: Schema.String,
  description: Schema.String,
  prompt: Schema.optional(Schema.String),
  subagentType: Schema.optional(Schema.Union([CursorNamedSubagentType, CursorCustomSubagentType])),
  model: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
});

export const CursorGenerateImageRequest = Schema.Struct({
  toolCallId: Schema.String,
  description: Schema.String,
  filePath: Schema.optional(Schema.String),
  referenceImagePaths: Schema.optional(Schema.Array(Schema.String)),
});

export function cursorSubagentTypeName(
  subagentType: (typeof CursorTaskRequest.Type)["subagentType"],
): string {
  if (!subagentType) {
    return "unspecified";
  }
  if (typeof subagentType === "string") {
    return subagentType;
  }
  const custom = subagentType.custom.trim();
  return custom.length > 0 ? custom : "custom";
}

function answerValues(answer: unknown): ReadonlyArray<string> {
  if (Array.isArray(answer)) {
    return answer.flatMap((entry) =>
      typeof entry === "string" && entry.trim() ? [entry.trim()] : [],
    );
  }
  if (typeof answer === "string" && answer.trim()) {
    return [answer.trim()];
  }
  return [];
}

export function formatCursorAskQuestionResponse(
  params: typeof CursorAskQuestionRequest.Type,
  answers: ProviderUserInputAnswers,
): {
  readonly outcome:
    | {
        readonly outcome: "answered";
        readonly answers: ReadonlyArray<{
          readonly questionId: string;
          readonly selectedOptionIds: ReadonlyArray<string>;
        }>;
      }
    | { readonly outcome: "skipped" };
} {
  const resolved = params.questions.flatMap((question) => {
    const values = answerValues(answers[question.id] ?? answers[question.prompt]);
    if (values.length === 0) {
      return [];
    }
    const selectedOptionIds = values.flatMap((value) => {
      const match = question.options.find(
        (option) => option.id === value || option.label === value,
      );
      return match ? [match.id] : [];
    });
    if (selectedOptionIds.length === 0) {
      return [];
    }
    return [{ questionId: question.id, selectedOptionIds }];
  });

  if (resolved.length === 0) {
    return { outcome: { outcome: "skipped" } };
  }

  return {
    outcome: {
      outcome: "answered",
      answers: resolved,
    },
  };
}

export function formatCursorCreatePlanResponse(): {
  readonly outcome: { readonly outcome: "accepted" };
} {
  return { outcome: { outcome: "accepted" } };
}

export function formatCursorUpdateTodosResponse(params: typeof CursorUpdateTodosRequest.Type): {
  readonly outcome: {
    readonly outcome: "accepted";
    readonly todos: ReadonlyArray<{
      readonly id: string;
      readonly content: string;
      readonly status: string;
    }>;
  };
} {
  return {
    outcome: {
      outcome: "accepted",
      todos: params.todos.map((todo, index) => ({
        id: todo.id?.trim() || `todo-${index + 1}`,
        content: todo.content?.trim() || todo.title?.trim() || "",
        status: todo.status ?? "pending",
      })),
    },
  };
}

export function formatCursorTaskResponse(params: typeof CursorTaskRequest.Type): {
  readonly outcome: {
    readonly outcome: "completed";
    readonly agentId?: string;
    readonly durationMs?: number;
  };
} {
  return {
    outcome: {
      outcome: "completed",
      ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
      ...(typeof params.durationMs === "number" ? { durationMs: params.durationMs } : {}),
    },
  };
}

export function formatCursorGenerateImageResponse(params: typeof CursorGenerateImageRequest.Type): {
  readonly outcome:
    | { readonly outcome: "generated"; readonly filePath: string }
    | { readonly outcome: "rejected"; readonly reason: string };
} {
  const filePath = params.filePath?.trim();
  if (!filePath) {
    return {
      outcome: {
        outcome: "rejected",
        reason: "Cursor did not supply a generated image path.",
      },
    };
  }
  return { outcome: { outcome: "generated", filePath } };
}

export function extractAskQuestions(
  params: typeof CursorAskQuestionRequest.Type,
): ReadonlyArray<UserInputQuestion> {
  return params.questions.map((question) => ({
    id: question.id,
    header: "Question",
    question: question.prompt,
    multiSelect: question.allowMultiple === true,
    options:
      question.options.length > 0
        ? question.options.map((option) => ({
            label: option.label,
            description: option.label,
          }))
        : [{ label: "OK", description: "Continue" }],
  }));
}

export function extractPlanMarkdown(params: typeof CursorCreatePlanRequest.Type): string {
  return params.plan || "# Plan\n\n(Cursor did not supply plan text.)";
}

export function extractTodosAsPlan(params: typeof CursorUpdateTodosRequest.Type): {
  readonly explanation?: string;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
} {
  const plan = params.todos.flatMap((todo) => {
    // Fall back to the title when content is missing OR blank. `??` only
    // covers a missing content, so a present-but-empty content ("" or
    // whitespace) would shadow a real title and drop the step below.
    const step = todo.content?.trim() || todo.title?.trim() || "";
    if (step === "") {
      return [];
    }
    const status: "pending" | "inProgress" | "completed" =
      todo.status === "completed"
        ? "completed"
        : todo.status === "in_progress" || todo.status === "inProgress"
          ? "inProgress"
          : "pending";
    return [{ step, status }];
  });
  return { plan };
}
