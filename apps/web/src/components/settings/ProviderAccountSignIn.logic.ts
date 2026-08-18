import type {
  ProviderAccountLoginEvent,
  ServerProvider,
  ServerProviderAccountLogin,
} from "@t3tools/contracts";

/**
 * Client-side view of one sign-in attempt. Phases advance only forward
 * (idle → starting → an interactive phase → succeeded/failed); `cancel`
 * resets to idle by aborting the underlying command.
 */
export type SignInPhase =
  | { readonly status: "idle" }
  | { readonly status: "starting" }
  | { readonly status: "authUrl"; readonly url: string }
  | { readonly status: "deviceCode"; readonly url: string; readonly userCode: string }
  | {
      readonly status: "awaitingCode";
      readonly url: string;
      readonly codeSubmitted: boolean;
    }
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly message: string };

export function phaseForLoginEvent(event: ProviderAccountLoginEvent): SignInPhase {
  switch (event.type) {
    case "authUrl":
      return { status: "authUrl", url: event.url };
    case "deviceCode":
      return { status: "deviceCode", url: event.url, userCode: event.userCode };
    case "awaitingCode":
      return { status: "awaitingCode", url: event.url, codeSubmitted: false };
    case "complete":
      return { status: "succeeded" };
  }
}

/** The provider-branded account name shown on sign-in buttons. */
export function signInAccountLabel(driver: string): string {
  switch (driver) {
    case "codex":
      return "ChatGPT";
    case "claudeAgent":
      return "Claude";
    default:
      return "account";
  }
}

/** Placeholder and helper copy for the API-key input, per driver. */
export function apiKeyHint(driver: string): { placeholder: string; description: string } {
  switch (driver) {
    case "codex":
      return {
        placeholder: "sk-...",
        description: "OpenAI API key. Stored by the Codex CLI in this instance's home.",
      };
    case "claudeAgent":
      return {
        placeholder: "sk-ant-...",
        description:
          "Anthropic API key. Stored as a sensitive ANTHROPIC_API_KEY variable on this instance.",
      };
    default:
      return { placeholder: "API key", description: "Stored for this provider instance." };
  }
}

/**
 * Login modes the driver is known to support even before a live snapshot
 * advertises `accountLogin`. Used by the add-instance wizard so Claude and
 * Codex can sign in immediately after the instance is created.
 */
const FALLBACK_ACCOUNT_LOGIN: Readonly<Record<string, ServerProviderAccountLogin>> = {
  claudeAgent: { modes: ["oauth", "apiKey"], supportsLogout: true },
  codex: { modes: ["oauth", "deviceCode", "apiKey"], supportsLogout: true },
};

/**
 * Prefer a live snapshot's advertisement (so mode lists stay driver-owned),
 * then the Claude/Codex fallback. Returns `undefined` for Cursor and other
 * drivers that do not yet run an in-app login.
 */
export function advertisedAccountLogin(
  driver: string,
  providers: ReadonlyArray<Pick<ServerProvider, "driver" | "accountLogin">>,
): ServerProviderAccountLogin | undefined {
  for (const provider of providers) {
    if (String(provider.driver) === driver && provider.accountLogin !== undefined) {
      return provider.accountLogin;
    }
  }
  return FALLBACK_ACCOUNT_LOGIN[driver];
}
