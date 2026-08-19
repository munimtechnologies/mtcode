/**
 * MT Auto router — local analog of Cursor Auto / Cursor Router.
 *
 * Cursor trains Compass on hundreds of thousands of live turns. We score each
 * turn locally (same $0 model as T3 Code: no cloud classifier). The resolved
 * provider+model is only used for the session; sticky selection stays
 * `mt` / `mt-auto`.
 */
import {
  DEFAULT_MT_MODEL_ROUTE_MODE,
  isMtModelSlug,
  MT_MODEL_ROUTE_MODE_OPTION_ID,
  MT_MODEL_ROUTE_MODES,
  type ModelSelection,
  type MtModelRouteMode,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
} from "@t3tools/contracts";

export type MtTaskKind =
  | "routine"
  | "git"
  | "frontend"
  | "debugging"
  | "planning"
  | "implementation"
  | "architecture";

export const MT_TASK_KINDS = [
  "routine",
  "git",
  "frontend",
  "debugging",
  "planning",
  "implementation",
  "architecture",
] as const;

export interface MtTurnClassification {
  readonly difficulty: number;
  readonly taskKind: MtTaskKind;
  readonly source?: "local" | "cloudflare";
}

export interface MtRouteCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly model: string;
  readonly ready: boolean;
  readonly usedPercent?: number | undefined;
}

export interface MtRouteDecision {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly driverKind: ProviderDriverKind;
  readonly reason: string;
  readonly classification: MtTurnClassification;
  readonly mode: MtModelRouteMode;
}

const EXHAUSTED_USAGE_PERCENT = 95;
const HIGH_USAGE_PERCENT = 80;

const ROUTINE_PATTERN =
  /\b(typo|rename|comment|format|prettier|eslint|lint|changelog|readme|docs?|wording|grammar)\b/i;
const GIT_PATTERN = /\b(git|commit|push|pull request|\bpr\b|rebase|stash|merge conflict|branch)\b/i;
const FRONTEND_PATTERN =
  /\b(css|tailwind|ui|ux|layout|button|icon|screenshot|visual|frontend|react native|swiftui|compose)\b/i;
const DEBUG_PATTERN =
  /\b(bug|debug|error|crash|stack trace|failing test|flaky|exception|regression|repro)\b/i;
const PLAN_PATTERN =
  /\b(plan(?:ning)?|investigate|explore|how should|what would|write a plan|trade-?offs?)\b/i;
const ARCHITECTURE_PATTERN =
  /\b(refactor|migrat(?:e|ion)|rewrite|concurren|security|distributed|multi-?tenant|performance)\b/i;
const IMPLEMENT_PATTERN =
  /\b(implement|add (?:a |the )?feature|wire up|create|build|hook up|land)\b/i;

export function parseMtModelRouteMode(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): MtModelRouteMode {
  const value = selections?.find(
    (selection) => selection.id === MT_MODEL_ROUTE_MODE_OPTION_ID,
  )?.value;
  if (typeof value === "string" && (MT_MODEL_ROUTE_MODES as readonly string[]).includes(value)) {
    return value as MtModelRouteMode;
  }
  return DEFAULT_MT_MODEL_ROUTE_MODE;
}

export function classifyMtTurn(input: {
  readonly prompt: string;
  readonly interactionMode?: "default" | "plan" | string | undefined;
  readonly attachmentCount?: number | undefined;
  readonly conversationTurnCount?: number | undefined;
  readonly recentFailureCount?: number | undefined;
}): MtTurnClassification {
  const prompt = input.prompt.trim();
  const lower = prompt.toLowerCase();
  let difficulty = 0.28;
  if (prompt.length > 900) {
    difficulty += 0.18;
  } else if (prompt.length > 280) {
    difficulty += 0.08;
  } else if (prompt.length < 60) {
    difficulty -= 0.08;
  }

  let taskKind: MtTaskKind = "implementation";
  if (PLAN_PATTERN.test(lower) || input.interactionMode === "plan") {
    taskKind = "planning";
    difficulty += 0.16;
  } else if (ARCHITECTURE_PATTERN.test(lower)) {
    taskKind = "architecture";
    difficulty += 0.28;
  } else if (DEBUG_PATTERN.test(lower)) {
    taskKind = "debugging";
    difficulty += 0.22;
  } else if (FRONTEND_PATTERN.test(lower)) {
    taskKind = "frontend";
    difficulty += 0.08;
  } else if (GIT_PATTERN.test(lower)) {
    taskKind = "git";
    difficulty -= 0.12;
  } else if (ROUTINE_PATTERN.test(lower)) {
    taskKind = "routine";
    difficulty -= 0.16;
  } else if (IMPLEMENT_PATTERN.test(lower)) {
    taskKind = "implementation";
    difficulty += 0.04;
  }

  if (input.interactionMode === "plan" && taskKind !== "planning") {
    difficulty += 0.12;
  }
  if ((input.attachmentCount ?? 0) > 0) {
    difficulty += 0.08;
    if (taskKind === "implementation") {
      taskKind = "frontend";
    }
  }
  const extraTurns = Math.max(0, (input.conversationTurnCount ?? 1) - 3);
  difficulty += Math.min(0.18, extraTurns * 0.04);
  difficulty += Math.min(0.24, Math.max(0, input.recentFailureCount ?? 0) * 0.12);

  return {
    difficulty: clamp01(difficulty),
    taskKind,
    source: "local",
  };
}

export function routeMtModel(input: {
  readonly classification: MtTurnClassification;
  readonly mode?: MtModelRouteMode | undefined;
  readonly candidates: ReadonlyArray<MtRouteCandidate>;
  readonly preferredInstanceId?: ProviderInstanceId | null | undefined;
}): MtRouteDecision | null {
  const mode = input.mode ?? DEFAULT_MT_MODEL_ROUTE_MODE;
  const usable = input.candidates.filter(
    (candidate) =>
      candidate.ready &&
      candidate.model.trim().length > 0 &&
      !isMtModelSlug(candidate.model) &&
      (candidate.usedPercent ?? 0) < EXHAUSTED_USAGE_PERCENT,
  );
  const fallbackPool =
    usable.length > 0
      ? usable
      : input.candidates.filter(
          (candidate) =>
            candidate.ready && candidate.model.trim().length > 0 && !isMtModelSlug(candidate.model),
        );
  if (fallbackPool.length === 0) {
    return null;
  }

  const preferredReady =
    input.preferredInstanceId &&
    fallbackPool.some((candidate) => candidate.instanceId === input.preferredInstanceId)
      ? input.preferredInstanceId
      : undefined;

  let best = fallbackPool[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of fallbackPool) {
    const score = scoreCandidate({
      candidate,
      classification: input.classification,
      mode,
      preferredInstanceId: preferredReady,
    });
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return {
    instanceId: best.instanceId,
    model: best.model,
    driverKind: best.driverKind,
    classification: input.classification,
    mode,
    reason: describeRoute(best, input.classification, mode, preferredReady),
  };
}

export function routeMtModelSelection(input: {
  readonly prompt: string;
  readonly stickySelection: ModelSelection;
  readonly candidates: ReadonlyArray<MtRouteCandidate>;
  readonly interactionMode?: "default" | "plan" | string | undefined;
  readonly attachmentCount?: number | undefined;
  readonly conversationTurnCount?: number | undefined;
  readonly recentFailureCount?: number | undefined;
  readonly preferredInstanceId?: ProviderInstanceId | null | undefined;
  readonly classification?: MtTurnClassification | undefined;
}): MtRouteDecision | null {
  const classification =
    input.classification ??
    classifyMtTurn({
      prompt: input.prompt,
      interactionMode: input.interactionMode,
      attachmentCount: input.attachmentCount,
      conversationTurnCount: input.conversationTurnCount,
      recentFailureCount: input.recentFailureCount,
    });
  return routeMtModel({
    classification,
    mode: parseMtModelRouteMode(input.stickySelection.options),
    candidates: input.candidates,
    preferredInstanceId: input.preferredInstanceId,
  });
}

export function parseMtTurnClassification(input: unknown): MtTurnClassification | null {
  const record = unwrapClassificationRecord(input);
  if (record === null) {
    return null;
  }
  const taskKind = record.taskKind;
  if (typeof taskKind !== "string" || !MT_TASK_KINDS.includes(taskKind as MtTaskKind)) {
    return null;
  }
  const difficulty = clamp01(Number(record.difficulty));
  if (!Number.isFinite(difficulty)) {
    return null;
  }
  return {
    difficulty,
    taskKind: taskKind as MtTaskKind,
    source: "cloudflare",
  };
}

const KEYWORD_STRONG_TASKS: ReadonlySet<MtTaskKind> = new Set([
  "routine",
  "git",
  "frontend",
  "debugging",
  "planning",
  "architecture",
]);

export function mergeMtTurnClassifications(
  local: MtTurnClassification,
  remote: MtTurnClassification | null | undefined,
): MtTurnClassification {
  if (!remote) {
    return local;
  }
  const taskKind = KEYWORD_STRONG_TASKS.has(local.taskKind) ? local.taskKind : remote.taskKind;
  const usedRemoteKind = taskKind === remote.taskKind;
  return {
    difficulty: Math.max(local.difficulty, remote.difficulty),
    taskKind,
    source: usedRemoteKind && remote.difficulty >= local.difficulty ? "cloudflare" : "local",
  };
}

function scoreCandidate(input: {
  readonly candidate: MtRouteCandidate;
  readonly classification: MtTurnClassification;
  readonly mode: MtModelRouteMode;
  readonly preferredInstanceId?: ProviderInstanceId | undefined;
}): number {
  const { candidate, classification, mode } = input;
  const profile = inferModelProfile(candidate.model, candidate.driverKind);
  const desiredTier = desiredCostTier(classification.difficulty, mode);
  let score = 8 - Math.abs(profile.costTier - desiredTier) * 3.4;
  score += affinityBonus(classification.taskKind, candidate.driverKind, profile);
  if (mode === "cost") {
    score += (3 - profile.costTier) * 1.4;
  } else if (mode === "intelligence") {
    score += profile.costTier * 1.2;
    if (classification.difficulty >= 0.55) {
      score += profile.costTier >= 3 ? 2.2 : 0;
    }
  }
  const used = candidate.usedPercent ?? 0;
  if (used >= HIGH_USAGE_PERCENT) {
    score -= (used - HIGH_USAGE_PERCENT) / 8;
  } else {
    score -= used / 140;
  }
  if (input.preferredInstanceId) {
    score += candidate.instanceId === input.preferredInstanceId ? 4.5 : -2.8;
  }
  if (
    candidate.driverKind === "cursor" &&
    (candidate.model === "auto" || candidate.model === "default")
  ) {
    score += mode === "intelligence" ? 0.4 : 1.6;
  }
  return score;
}

function desiredCostTier(difficulty: number, mode: MtModelRouteMode): 1 | 2 | 3 {
  if (mode === "cost") {
    return difficulty >= 0.78 ? 2 : 1;
  }
  if (mode === "intelligence") {
    return difficulty >= 0.42 ? 3 : 2;
  }
  if (difficulty < 0.34) {
    return 1;
  }
  if (difficulty < 0.62) {
    return 2;
  }
  return 3;
}

function affinityBonus(
  taskKind: MtTaskKind,
  driverKind: ProviderDriverKind,
  profile: ModelProfile,
): number {
  const driver = String(driverKind);
  switch (taskKind) {
    case "git":
    case "routine":
      return profile.costTier === 1 ? 2.4 : 0.2;
    case "frontend":
      return driver === "claudeAgent" || driver === "cursor" ? 2.6 : 0.4;
    case "debugging":
      return profile.costTier >= 3 || driver === "claudeAgent" || driver === "cursor" ? 2.4 : 0.3;
    case "planning":
      return driver === "codex" || profile.planning ? 2.8 : 0.6;
    case "architecture":
      return profile.costTier >= 3 ? 2.6 : 0.2;
    default:
      return profile.costTier === 2 ? 1.2 : 0.5;
  }
}

interface ModelProfile {
  readonly costTier: 1 | 2 | 3;
  readonly planning: boolean;
}

function inferModelProfile(model: string, driverKind: ProviderDriverKind): ModelProfile {
  const slug = model.toLowerCase();
  const planning = slug.includes("sol") || slug.includes("opus") || String(driverKind) === "codex";
  if (
    slug === "auto" ||
    slug === "default" ||
    slug.includes("haiku") ||
    slug.includes("flash") ||
    slug.includes("mini") ||
    slug.includes("luna") ||
    slug.includes("fast") ||
    slug.includes("composer") ||
    slug.includes("grok")
  ) {
    return { costTier: 1, planning: slug.includes("composer") ? false : planning };
  }
  if (
    slug.includes("opus") ||
    slug.includes("fable") ||
    slug.includes("sol") ||
    slug.includes("max")
  ) {
    return { costTier: 3, planning };
  }
  return { costTier: 2, planning };
}

function describeRoute(
  candidate: MtRouteCandidate,
  classification: MtTurnClassification,
  mode: MtModelRouteMode,
  preferredInstanceId: ProviderInstanceId | undefined,
): string {
  const parts = [
    `difficulty ${classification.difficulty.toFixed(2)}`,
    classification.taskKind,
    `${mode} mode`,
  ];
  if (typeof candidate.usedPercent === "number") {
    parts.push(`${Math.round(candidate.usedPercent)}% used`);
  }
  if (preferredInstanceId && candidate.instanceId === preferredInstanceId) {
    parts.push("kept session");
  }
  if (classification.source === "cloudflare") {
    parts.push("cloudflare");
  }
  return `MT Auto → ${candidate.model} (${parts.join(", ")})`;
}

function unwrapClassificationRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input === "string") {
    const match = input.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(match[0]);
      return unwrapClassificationRecord(parsed);
    } catch {
      return null;
    }
  }
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if ("taskKind" in record || "difficulty" in record) {
    return record;
  }
  if (typeof record.response === "string" || typeof record.response === "object") {
    return unwrapClassificationRecord(record.response);
  }
  if (typeof record.result === "object" && record.result !== null) {
    return unwrapClassificationRecord(record.result);
  }
  return null;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
