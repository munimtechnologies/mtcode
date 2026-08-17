/**
 * Project a full personal usage summary down to what an older hosted client
 * (https://app.t3.codes) can decode.
 *
 * Personal builds are often many commits ahead of main. Their summaries include
 * providers (`cursor` / `grok` / `opencode`) and contractVersion 6 that the
 * hosted web Schema.Literals reject — every connected environment then shows
 * "could not report usage." When the client does not advertise a matching
 * contract version, strip unknown providers and report the hosted version.
 *
 * @module usageClientCompat
 */
import {
  HOSTED_USAGE_CONTRACT_VERSION,
  HOSTED_USAGE_PROVIDER_KINDS,
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";

const HOSTED_PROVIDER_SET = new Set<string>(HOSTED_USAGE_PROVIDER_KINDS);

function isHostedProvider(provider: UsageProviderKind): boolean {
  return HOSTED_PROVIDER_SET.has(provider);
}

/**
 * Resolve which wire contract to emit for this request.
 *
 * Missing / non-finite / below hosted → hosted v4 projection.
 * At or above the personal contract → full personal summary.
 * Between hosted and personal → still project to hosted (no intermediate shapes).
 */
export function resolveUsageWireContractVersion(clientContractVersion: number | undefined): number {
  if (
    clientContractVersion === undefined ||
    !Number.isFinite(clientContractVersion) ||
    clientContractVersion < USAGE_CONTRACT_VERSION
  ) {
    return HOSTED_USAGE_CONTRACT_VERSION;
  }
  return USAGE_CONTRACT_VERSION;
}

export function projectUsageSummaryForClient(
  summary: UsageSummary,
  clientContractVersion: number | undefined,
): UsageSummary {
  const wireVersion = resolveUsageWireContractVersion(clientContractVersion);
  if (wireVersion >= USAGE_CONTRACT_VERSION) {
    return summary;
  }

  return {
    ...summary,
    contractVersion: HOSTED_USAGE_CONTRACT_VERSION,
    buckets: summary.buckets.filter((bucket) => isHostedProvider(bucket.provider)),
    sources: summary.sources.filter((source) => isHostedProvider(source.fingerprint.provider)),
  };
}
