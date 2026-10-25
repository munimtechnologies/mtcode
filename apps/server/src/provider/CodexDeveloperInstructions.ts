import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import { DESKTOP_MCP_SERVER_NAME } from "@t3tools/contracts";
import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

const T3_CODE_DEVICE_TOOL_INSTRUCTIONS = `## T3 Code devices

For iOS Simulators and Android Emulators here, call \`device_list\`, then \`device_open\`. Drive the device with the exact \`agent-device\` launcher and flags it returns, on every command. Prefer \`agent-device snapshot -i\` refs over coordinates. Use \`device_screenshot\` to see the screen. Use \`xcrun simctl\` or \`adb\` only for builds, logs, and ports. If a platform is unavailable, say so.`;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (availability: boolean | T3CodeToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? T3_CODE_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const T3_CODE_COMPUTER_TOOL_INSTRUCTIONS = `

## Other computers

For work that belongs on another connected computer (its desktop, OS, files, or GPU), call \`computer_list\`, then \`computer_send\` with the full task in \`message\`; that computer does not see this transcript. Set \`computer\` to an id, label, SSH host, or \`this\`. Do not ask the user to switch the Run on picker.
`;

const T3_CODE_DESKTOP_TOOL_INSTRUCTIONS = `

## Computer Use

The \`${DESKTOP_MCP_SERVER_NAME}\` MCP server drives this computer's GUI; its pointer overlay does not move the user's mouse. Look, act, verify: read the screen with \`list_apps\` or \`get_app_state\`, act with \`click\`, \`type_text\`, \`set_value\`, \`press_key\`, \`scroll\`, \`drag\`, or \`hover\`, then check with \`get_app_state\` or \`screenshot\` before the next step. Prefer element ids over coordinates; take coordinates from a screenshot's result text, converting pixels to screen points. Use \`zoom\` for small text, \`get_app_state\` with \`query\` to find a control by label, \`wait\` after loads, and keyboard shortcuts over fiddly controls. Use \`browser_*\` tools for Chrome tabs you own. Do not ask the user to click for you. If Accessibility or Screen Recording is missing, tell them to grant it in Settings → Computer Use.
`;

const T3_CODE_COMPUTER_HOME_INSTRUCTIONS = `

## Whole-computer thread

The working directory is this machine's home folder. Files anywhere, the terminal, and Computer Use are in scope. Pick a project folder only when asked or when the task clearly lives in one repo.
`;

interface CodexExtraToolInstructions {
  readonly browserToolsAvailable: boolean | T3CodeToolAvailability;
  readonly desktopToolsAvailable?: boolean;
  readonly computerHomeWorkspace?: boolean;
}

const extraToolInstructions = (options: CodexExtraToolInstructions): string =>
  `${toolInstructions(options.browserToolsAvailable)}${options.browserToolsAvailable === false ? "" : T3_CODE_COMPUTER_TOOL_INSTRUCTIONS}`;

// Its own entry: added to the tool text it would push past Codex's per-entry cap.
const desktopToolInstructions = (options: CodexExtraToolInstructions): string =>
  `${options.desktopToolsAvailable === true ? T3_CODE_DESKTOP_TOOL_INSTRUCTIONS : ""}${
    options.computerHomeWorkspace === true ? T3_CODE_COMPUTER_HOME_INSTRUCTIONS : ""
  }`.trim();

const T3_CODE_CHAT_HISTORY_INSTRUCTIONS = `

## Chat history

Repository instructions, environment context, skills, and other harness setup are not user messages. When asked about an earlier message, answer from what the user wrote.
`;

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability = true,
  options?: {
    readonly computerHistoryContext?: string;
    readonly desktopToolsAvailable?: boolean;
    readonly computerHomeWorkspace?: boolean;
  },
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = extraToolInstructions({ browserToolsAvailable: toolsAvailable, ...options });
  const desktopTools = desktopToolInstructions({
    browserToolsAvailable: toolsAvailable,
    ...options,
  });
  // Separate keys keep each value under Codex's per-entry cap. Codex emits
  // entries in key order, so the numbering preserves the authored order.
  return {
    ...Object.fromEntries(
      T3_CODE_ORCHESTRATION_SECTIONS.map((section, index) => [
        `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    t3_code_chat_history: { kind: "application", value: T3_CODE_CHAT_HISTORY_INSTRUCTIONS },
    ...(options?.computerHistoryContext
      ? {
          mt_code_computer_history: {
            kind: "application" as const,
            value: options.computerHistoryContext,
          },
        }
      : {}),
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
    ...(desktopTools
      ? { mt_code_desktop_tools: { kind: "application" as const, value: desktopTools } }
      : {}),
  };
}
