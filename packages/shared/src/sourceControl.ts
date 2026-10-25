const CHANGE_REQUEST_URL_PATTERNS = [
  /https:\/\/[^\s<>()]+\/[^/\s<>()]+\/[^/\s<>()]+\/pull\/\d+(?:[/?#][^\s<>()]*)?/i,
  /https:\/\/[^\s<>()]+\/[^\s<>()]+\/-\/merge_requests\/\d+(?:[/?#][^\s<>()]*)?/i,
  /https:\/\/[^\s<>()]+\/[^\s<>()]+\/_git\/[^/\s<>()]+\/pullrequest\/\d+(?:[/?#][^\s<>()]*)?/i,
  /https:\/\/[^\s<>()]+\/[^/\s<>()]+\/[^/\s<>()]+\/pull-requests\/\d+(?:[/?#][^\s<>()]*)?/i,
] as const;

/** Detects a source-control change request URL embedded in agent-authored text. */
export function containsChangeRequestUrl(text: string): boolean {
  return CHANGE_REQUEST_URL_PATTERNS.some((pattern) => pattern.test(text));
}

const SCP_SSH_REMOTE_PATTERN = /^[a-zA-Z0-9._-]+@([^:/]+):/;

export function isSshRemoteUrl(remoteUrl: string): boolean {
  const trimmed = remoteUrl.trim();
  return SCP_SSH_REMOTE_PATTERN.test(trimmed) || trimmed.toLowerCase().startsWith("ssh://");
}
