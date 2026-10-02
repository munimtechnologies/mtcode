import type { HostResourcesSnapshot } from "@t3tools/contracts";

/** Callers supply only connected machines hosting the project and selected provider. */
export function chooseLoadBalancedEnvironment(
  candidates: ReadonlyArray<{
    environmentId: string;
    resources: HostResourcesSnapshot | null;
    /** Client receipt time avoids comparing clocks on different machines. */
    receivedAt?: number;
    weight: number;
  }>,
  now: number,
): string | null {
  let selected: string | null = null;
  let bestScore = 0;
  for (const { environmentId, resources, receivedAt, weight } of candidates) {
    const sampledAt = receivedAt ?? resources?.sampledAt ?? 0;
    if (
      !resources ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      now - sampledAt > 15_000 ||
      sampledAt > now + 5_000 ||
      resources.cpuUtilization === null ||
      resources.cpuUtilization >= 0.95 ||
      resources.totalMemoryBytes <= 0 ||
      resources.cpuCount <= 0
    ) {
      continue;
    }
    const memoryAvailable = resources.availableMemoryBytes / resources.totalMemoryBytes;
    if (memoryAvailable <= 0.05) continue;
    const score = weight * resources.cpuCount * (1 - resources.cpuUtilization) * memoryAvailable;
    if (score > bestScore) {
      selected = environmentId;
      bestScore = score;
    }
  }
  return selected;
}

/** The operating systems a task can be pinned to when it is routed. */
export type TaskPlatform = "mac" | "windows" | "linux";

export function taskPlatformForOs(os: string | null | undefined): TaskPlatform | null {
  switch (os) {
    case "darwin":
      return "mac";
    case "windows":
      return "windows";
    case "linux":
      return "linux";
    default:
      return null;
  }
}

const TASK_PLATFORM_HINTS: ReadonlyArray<{ platform: TaskPlatform; pattern: RegExp }> = [
  {
    platform: "mac",
    pattern:
      /\b(?:mac\s?os|os\s?x|xcode(?:build)?|xcrun|swiftui|appkit|uikit|ios|ipados|watchos|visionos|cocoapods|pod install|homebrew|brew (?:install|upgrade|services)|osascript|apple\s?script|launchctl|launchd|finder|keychain|testflight|notari[sz](?:e|ation)|codesign|app store connect|imessage|safari|(?:on|in|from) (?:my |the )?mac(?:book)?)\b|\.(?:dmg|pkg|plist|xcodeproj|xcworkspace)\b/i,
  },
  {
    platform: "windows",
    pattern:
      /\b(?:powershell|pwsh|winget|chocolatey|choco install|msbuild|regedit|registry key|task scheduler|win32|winui|wpf|winforms|nsis|directx|visual studio(?! code)|(?:on|in|for) (?:my |the )?windows(?: machine| pc| box| laptop| computer)?|windows (?:machine|pc|box|laptop|computer|app|build|installer|service|terminal|defender))\b|\.(?:ps1|exe|msi|bat|cmd|sln|vcxproj)\b/i,
  },
  {
    platform: "linux",
    pattern:
      /\b(?:apt(?:-get)? install|systemctl|systemd|journalctl|ubuntu|debian|fedora|appimage|(?:on|in|for) (?:my |the )?linux(?: machine| box| server)?)\b|\.deb\b/i,
  },
];

/**
 * Cheap keyword read of which operating system a prompt needs. Returns null
 * when it names none, or more than one (a port between platforms can run on
 * either side). Never a model call: it runs on every routed send.
 */
export function detectTaskPlatform(prompt: string): TaskPlatform | null {
  const matches = TASK_PLATFORM_HINTS.filter(({ pattern }) => pattern.test(prompt));
  return matches.length === 1 ? matches[0]!.platform : null;
}

const MAX_MENTIONED_PATHS = 12;
const MAX_PATH_LENGTH = 512;
const PATH_TRAILING_PUNCTUATION = /[.,:;!?)\]}>'"`]+$/;
const PATH_PATTERNS: readonly RegExp[] = [
  // Quoted or backticked paths, which may contain spaces.
  /["'`]((?:~|[A-Za-z]:|\.{1,2})?[\\/][^"'`\n]+)["'`]/g,
  // Home-relative: ~/dev/project
  /(?<![\w~])~[\\/][^\s"'`<>|]*/g,
  // Windows absolute: C:\Users\me\dev or C:/Users/me/dev
  /(?<![\w])[A-Za-z]:[\\/][^\s"'`<>|*?]*/g,
  // POSIX absolute, excluding URL tails (https://host/path) and `//` comments.
  /(?<![\w:/.~\\-])\/[\w.@+-]+(?:\/[\w.@+-]*)*/g,
  // Relative with at least one separator: dev/project, src/index.ts
  /(?<![\w:/.~\\-])\.{0,2}[\\/]?[\w@+-][\w.@+-]*(?:[\\/][\w.@+-]+)+/g,
];

/**
 * Paths a prompt mentions, in first-seen order. Over-matching is harmless:
 * routing only keeps paths that exist on at least one candidate machine, so a
 * URL fragment or "and/or" simply resolves nowhere and is ignored.
 */
export function extractMentionedPaths(prompt: string): string[] {
  const found = new Set<string>();
  for (const pattern of PATH_PATTERNS) {
    for (const match of prompt.matchAll(pattern)) {
      const raw = (match[1] ?? match[0]).trim().replace(PATH_TRAILING_PUNCTUATION, "");
      if (raw.length < 2 || raw.length > MAX_PATH_LENGTH || raw.includes("://")) continue;
      found.add(raw);
      if (found.size >= MAX_MENTIONED_PATHS) return [...found];
    }
  }
  return [...found];
}

/** "on Blade", "use the Mac mini": a prompt that names a connected machine. */
export function findMentionedEnvironment(
  prompt: string,
  candidates: ReadonlyArray<{ environmentId: string; label: string }>,
): string | null {
  const named = candidates.filter(({ label }) => {
    const trimmed = label.trim();
    if (trimmed.length < 3) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`\\b(?:on|use|using|via)\\s+(?:the\\s+)?${escaped}(?![\\w'])`, "i").test(
      prompt,
    );
  });
  return named.length === 1 ? named[0]!.environmentId : null;
}

export interface TaskRoutingCandidate {
  readonly environmentId: string;
  readonly label: string;
  readonly platform: TaskPlatform | null;
  readonly resources: HostResourcesSnapshot | null;
  readonly receivedAt?: number;
  readonly weight: number;
  /** Which mentioned paths exist there; null when the machine could not answer. */
  readonly existingPaths: ReadonlySet<string> | null;
}

export type TaskRoutingDecision =
  | {
      readonly kind: "chosen";
      readonly environmentId: string;
      readonly reason: "named" | "balanced";
    }
  | {
      readonly kind: "none";
      readonly reason: "no-platform-match" | "no-path-match" | "no-capacity";
    };

/**
 * Picks the machine a new computer-wide thread should run on: a machine the
 * prompt names wins outright; otherwise the candidates are narrowed to the
 * required operating system, then to the machines holding every mentioned
 * path that exists anywhere, and the least loaded of those is chosen.
 */
export function chooseTaskEnvironment(input: {
  readonly prompt: string;
  readonly candidates: ReadonlyArray<TaskRoutingCandidate>;
  readonly mentionedPaths: readonly string[];
  /** The user's "Run on" pick; null means read it from the prompt. */
  readonly platformOverride: TaskPlatform | null;
  readonly now: number;
}): TaskRoutingDecision {
  const namedId = findMentionedEnvironment(input.prompt, input.candidates);
  const named = input.candidates.find((candidate) => candidate.environmentId === namedId);
  if (
    named !== undefined &&
    (input.platformOverride === null || named.platform === input.platformOverride)
  ) {
    return { kind: "chosen", environmentId: named.environmentId, reason: "named" };
  }

  const platform = input.platformOverride ?? detectTaskPlatform(input.prompt);
  const onPlatform =
    platform === null
      ? input.candidates
      : input.candidates.filter((candidate) => candidate.platform === platform);
  if (onPlatform.length === 0) return { kind: "none", reason: "no-platform-match" };

  // A path no machine has is a typo, a URL fragment, or something the task
  // will create; only paths that exist somewhere constrain the choice.
  const requiredPaths = input.mentionedPaths.filter((path) =>
    input.candidates.some((candidate) => candidate.existingPaths?.has(path) === true),
  );
  const withPaths =
    requiredPaths.length === 0
      ? onPlatform
      : onPlatform.filter((candidate) =>
          requiredPaths.every((path) => candidate.existingPaths?.has(path) === true),
        );
  if (withPaths.length === 0) return { kind: "none", reason: "no-path-match" };

  const environmentId = chooseLoadBalancedEnvironment(withPaths, input.now);
  return environmentId === null
    ? { kind: "none", reason: "no-capacity" }
    : { kind: "chosen", environmentId, reason: "balanced" };
}
