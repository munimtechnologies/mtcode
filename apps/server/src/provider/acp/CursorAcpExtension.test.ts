import { describe, expect, it } from "vite-plus/test";

import {
  CursorGenerateImageRequest,
  CursorListAvailableModelsResponse,
  CursorTaskRequest,
  cursorSubagentTypeName,
  extractAskQuestions,
  extractPlanMarkdown,
  extractTodosAsPlan,
  formatCursorAskQuestionResponse,
  formatCursorCreatePlanResponse,
  formatCursorGenerateImageResponse,
  formatCursorTaskResponse,
  formatCursorUpdateTodosResponse,
} from "./CursorAcpExtension.ts";

describe("CursorAcpExtension", () => {
  it("extracts ask-question prompts from the real Cursor ACP payload shape", () => {
    const questions = extractAskQuestions({
      toolCallId: "ask-1",
      title: "Need input",
      questions: [
        {
          id: "language",
          prompt: "Which language should I use?",
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "rs", label: "Rust" },
          ],
          allowMultiple: false,
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "language",
        header: "Question",
        question: "Which language should I use?",
        multiSelect: false,
        options: [
          { label: "TypeScript", description: "TypeScript" },
          { label: "Rust", description: "Rust" },
        ],
      },
    ]);
  });

  it("defaults ask-question multi-select to false when Cursor omits allowMultiple", () => {
    const questions = extractAskQuestions({
      toolCallId: "ask-2",
      questions: [
        {
          id: "mode",
          prompt: "Which mode should I use?",
          options: [
            { id: "agent", label: "Agent" },
            { id: "plan", label: "Plan" },
          ],
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "mode",
        header: "Question",
        question: "Which mode should I use?",
        multiSelect: false,
        options: [
          { label: "Agent", description: "Agent" },
          { label: "Plan", description: "Plan" },
        ],
      },
    ]);
  });

  it("extracts plan markdown from the real Cursor create-plan payload shape", () => {
    const planMarkdown = extractPlanMarkdown({
      toolCallId: "plan-1",
      name: "Refactor parser",
      overview: "Tighten ACP parsing",
      plan: "# Plan\n\n1. Add schemas\n2. Remove casts",
      todos: [
        { id: "t1", content: "Add schemas", status: "in_progress" },
        { id: "t2", content: "Remove casts", status: "pending" },
      ],
      isProject: false,
    });

    expect(planMarkdown).toBe("# Plan\n\n1. Add schemas\n2. Remove casts");
  });

  it("projects todo updates into a plan shape and drops invalid entries", () => {
    expect(
      extractTodosAsPlan({
        toolCallId: "todos-1",
        todos: [
          { id: "1", content: "Inspect state", status: "completed" },
          { id: "2", content: "  Apply fix  ", status: "in_progress" },
          { id: "3", title: "Fallback title", status: "pending" },
          { id: "4", content: "Unknown status", status: "weird_status" },
          { id: "5", content: "   " },
        ],
        merge: true,
      }),
    ).toEqual({
      plan: [
        { step: "Inspect state", status: "completed" },
        { step: "Apply fix", status: "inProgress" },
        { step: "Fallback title", status: "pending" },
        { step: "Unknown status", status: "pending" },
      ],
    });
  });

  it("falls back to the title when content is present but blank", () => {
    expect(
      extractTodosAsPlan({
        toolCallId: "todos-2",
        todos: [
          { id: "1", content: "", title: "Titled step", status: "pending" },
          { id: "2", content: "   ", title: "Whitespace content", status: "in_progress" },
          { id: "3", content: "", title: "", status: "pending" },
        ],
        merge: true,
      }),
    ).toEqual({
      plan: [
        { step: "Titled step", status: "pending" },
        { step: "Whitespace content", status: "inProgress" },
      ],
    });
  });

  it("formats ask-question answers with option ids, including label matches", () => {
    const params = {
      toolCallId: "ask-1",
      questions: [
        {
          id: "language",
          prompt: "Which language should I use?",
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "rs", label: "Rust" },
          ],
        },
      ],
    };

    expect(formatCursorAskQuestionResponse(params, { language: "TypeScript" })).toEqual({
      outcome: {
        outcome: "answered",
        answers: [{ questionId: "language", selectedOptionIds: ["ts"] }],
      },
    });
    expect(formatCursorAskQuestionResponse(params, {})).toEqual({
      outcome: { outcome: "skipped" },
    });
  });

  it("formats create-plan, update-todos, task, and generate-image responses", () => {
    expect(formatCursorCreatePlanResponse()).toEqual({ outcome: { outcome: "accepted" } });
    expect(
      formatCursorUpdateTodosResponse({
        toolCallId: "todos-1",
        todos: [{ id: "1", content: "Inspect state", status: "completed" }],
        merge: true,
      }),
    ).toEqual({
      outcome: {
        outcome: "accepted",
        todos: [{ id: "1", content: "Inspect state", status: "completed" }],
      },
    });

    const task = CursorTaskRequest.make({
      toolCallId: "task-1",
      description: "Explore codebase",
      prompt: "Find auth",
      subagentType: "explore",
      agentId: "agent-1",
      durationMs: 40,
    });
    expect(cursorSubagentTypeName(task.subagentType)).toBe("explore");
    expect(cursorSubagentTypeName({ custom: "reviewer" })).toBe("reviewer");
    expect(formatCursorTaskResponse(task)).toEqual({
      outcome: { outcome: "completed", agentId: "agent-1", durationMs: 40 },
    });

    const image = CursorGenerateImageRequest.make({
      toolCallId: "image-1",
      description: "App icon",
      filePath: "/tmp/icon.png",
    });
    expect(formatCursorGenerateImageResponse(image)).toEqual({
      outcome: { outcome: "generated", filePath: "/tmp/icon.png" },
    });
    expect(
      formatCursorGenerateImageResponse({
        toolCallId: "image-2",
        description: "Missing path",
      }),
    ).toEqual({
      outcome: {
        outcome: "rejected",
        reason: "Cursor did not supply a generated image path.",
      },
    });
  });

  it("decodes Cursor list_available_models responses with per-model config options", () => {
    const decoded = CursorListAvailableModelsResponse.make({
      models: [
        {
          value: "gpt-5.4",
          name: "GPT-5.4",
          configOptions: [
            {
              id: "reasoning",
              name: "Reasoning",
              category: "thought_level",
              type: "select",
              currentValue: "medium",
              options: [
                { value: "low", name: "Low" },
                { value: "medium", name: "Medium" },
              ],
            },
          ],
        },
      ],
    });

    expect(decoded.models[0]?.configOptions?.[0]?.id).toBe("reasoning");
  });
});
