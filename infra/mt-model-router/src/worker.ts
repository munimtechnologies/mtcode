/**
 * MT Model classifier — Cloudflare Worker + Workers AI.
 *
 * Stays on the Workers Free plan. Llama 3.2 1B is ~1–2 neurons per classify
 * against a 10,000 neuron/day free allotment. If the quota is exhausted the
 * worker returns 503 and MT Code falls back to its local heuristic. Do not
 * enable Workers Paid for this worker.
 */

const MODEL = "@cf/meta/llama-3.2-1b-instruct";
const MAX_PROMPT_CHARS = 400;
const MAX_OUTPUT_TOKENS = 96;
const RATE_LIMIT_PER_MINUTE = 120;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};
const TASK_KINDS = [
  "routine",
  "git",
  "frontend",
  "debugging",
  "planning",
  "implementation",
  "architecture",
] as const;

type TaskKind = (typeof TASK_KINDS)[number];

interface AiBinding {
  run: (
    model: string,
    input: {
      prompt: string;
      max_tokens: number;
    },
  ) => Promise<unknown>;
}

interface Env {
  AI: AiBinding;
}

const rateBuckets = new Map<string, { minute: number; count: number }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return json({ ok: true });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/classify") {
      return json({ error: "not_found" }, 404);
    }
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allow(ip)) {
      return json({ error: "rate_limited" }, 429);
    }

    let body: { prompt?: unknown; interactionMode?: unknown };
    try {
      body = (await request.json()) as { prompt?: unknown; interactionMode?: unknown };
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : "";
    if (prompt.length === 0) {
      return json({ error: "missing_prompt" }, 400);
    }
    const interactionMode =
      typeof body.interactionMode === "string" ? body.interactionMode.slice(0, 32) : "default";

    let result: unknown;
    try {
      result = await env.AI.run(MODEL, {
        prompt: [
          "Classify the coding task. Output JSON only.",
          'Format: {"difficulty":0.0,"taskKind":"routine"}',
          "difficulty 0 to 1. taskKind one of: routine, git, frontend, debugging, planning, implementation, architecture.",
          'typo in readme => {"difficulty":0.05,"taskKind":"routine"}',
          'app crash with stack trace => {"difficulty":0.75,"taskKind":"debugging"}',
          `interactionMode=${interactionMode}`,
          "Task:",
          prompt,
          "JSON:",
        ].join("\n"),
        max_tokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      return json({ error: "ai_failed", detail: detail.slice(0, 200) }, 503);
    }
    const parsed = parseClassification(result);
    if (parsed === null) {
      const raw =
        typeof result === "string"
          ? result
          : result === undefined || result === null
            ? String(result)
            : JSON.stringify(result);
      return json({ error: "unclassified", detail: raw.slice(0, 300) }, 503);
    }
    return json(parsed);
  },
};

function allow(ip: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const current = rateBuckets.get(ip);
  if (!current || current.minute !== minute) {
    rateBuckets.set(ip, { minute, count: 1 });
    if (rateBuckets.size > 2_000) {
      rateBuckets.clear();
    }
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_PER_MINUTE;
}

function parseClassification(value: unknown): { difficulty: number; taskKind: TaskKind } | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as { difficulty?: unknown; taskKind?: unknown; response?: unknown };
    const fromRecord = parseClassificationRecord(record);
    if (fromRecord) {
      return fromRecord;
    }
    if ("response" in record) {
      return parseClassification(record.response);
    }
  }
  const text =
    typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : JSON.stringify(value);
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const fromJson = parseClassificationRecord(
        JSON.parse(match[0]) as { difficulty?: unknown; taskKind?: unknown },
      );
      if (fromJson) {
        return fromJson;
      }
    } catch {
      // Fall through to prose parsing.
    }
  }
  return parseClassificationProse(text);
}

function parseClassificationProse(text: string): { difficulty: number; taskKind: TaskKind } | null {
  const kindMatch = text.match(
    /\b(routine|git|frontend|debugging|planning|implementation|architecture)\b/i,
  );
  if (!kindMatch) {
    return null;
  }
  const difficultyMatch = text.match(/difficulty[^0-9]*([01](?:\.\d+)?)/i);
  const difficulty = difficultyMatch ? Number(difficultyMatch[1]) : 0.3;
  if (!Number.isFinite(difficulty)) {
    return null;
  }
  return {
    difficulty: Math.min(1, Math.max(0, difficulty)),
    taskKind: kindMatch[1]!.toLowerCase() as TaskKind,
  };
}

function parseClassificationRecord(parsed: {
  difficulty?: unknown;
  taskKind?: unknown;
}): { difficulty: number; taskKind: TaskKind } | null {
  const taskKind = parsed.taskKind;
  if (typeof taskKind !== "string" || !TASK_KINDS.includes(taskKind as TaskKind)) {
    return null;
  }
  const difficulty = Number(parsed.difficulty);
  if (!Number.isFinite(difficulty)) {
    return null;
  }
  return {
    difficulty: Math.min(1, Math.max(0, difficulty)),
    taskKind: taskKind as TaskKind,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}
