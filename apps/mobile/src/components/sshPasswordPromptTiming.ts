export interface SshPasswordPromptTiming {
  readonly isExpired: boolean;
  readonly remainingLabel: string | null;
  readonly remainingSeconds: number | null;
}

function formatRemainingSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function getSshPasswordPromptTiming(
  expiresAt: string,
  nowMs: number,
): SshPasswordPromptTiming {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return {
      isExpired: false,
      remainingLabel: null,
      remainingSeconds: null,
    };
  }

  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  return {
    isExpired: remainingMs <= 0,
    remainingLabel: formatRemainingSeconds(remainingSeconds),
    remainingSeconds,
  };
}
