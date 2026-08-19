import {
  isMtModelInstanceId,
  isMtModelSelection,
  type AccountLimitsSnapshot,
  type ModelSelection,
  type ProviderInteractionMode,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  classifyMtTurn,
  mergeMtTurnClassifications,
  parseMtModelRouteMode,
  routeMtModel,
  type MtRouteCandidate,
  type MtRouteDecision,
} from "@t3tools/shared/mtModelRouter";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { MtModelCloudflareClassifier } from "./mtModelCloudflare.ts";

export function buildMtRouteCandidates(
  providers: ReadonlyArray<ServerProvider>,
  snapshots: ReadonlyArray<AccountLimitsSnapshot> = [],
): ReadonlyArray<MtRouteCandidate> {
  const usedByInstance = new Map<string, number>();
  for (const snapshot of snapshots) {
    const instanceId = snapshot.instanceId;
    if (!instanceId) {
      continue;
    }
    const used = Math.max(0, ...snapshot.windows.map((window) => window.usedPercent));
    const current = usedByInstance.get(instanceId) ?? 0;
    if (used > current) {
      usedByInstance.set(instanceId, used);
    }
  }

  const candidates: MtRouteCandidate[] = [];
  for (const provider of providers) {
    if (isMtModelInstanceId(provider.instanceId)) {
      continue;
    }
    const ready =
      provider.enabled &&
      provider.availability !== "unavailable" &&
      (provider.status === "ready" || provider.status === "warning");
    const usedPercent = usedByInstance.get(provider.instanceId);
    for (const model of provider.models) {
      if (model.isLegacy || model.isCustom) {
        continue;
      }
      candidates.push({
        instanceId: provider.instanceId,
        driverKind: provider.driver,
        model: model.slug,
        ready,
        ...(usedPercent !== undefined ? { usedPercent } : {}),
      });
    }
  }
  return candidates;
}

export function resolveMtModelForTurn(input: {
  readonly stickySelection: ModelSelection;
  readonly prompt: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly snapshots?: ReadonlyArray<AccountLimitsSnapshot>;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly attachmentCount?: number | undefined;
  readonly conversationTurnCount?: number | undefined;
  readonly recentFailureCount?: number | undefined;
  readonly preferredInstanceId?: ModelSelection["instanceId"] | null | undefined;
}): MtRouteDecision | null {
  if (!isMtModelSelection(input.stickySelection)) {
    return null;
  }
  return routeMtModel({
    classification: classifyMtTurn({
      prompt: input.prompt,
      interactionMode: input.interactionMode,
      attachmentCount: input.attachmentCount,
      conversationTurnCount: input.conversationTurnCount,
      recentFailureCount: input.recentFailureCount,
    }),
    mode: parseMtModelRouteMode(input.stickySelection.options),
    candidates: buildMtRouteCandidates(input.providers, input.snapshots ?? []),
    preferredInstanceId: isMtModelInstanceId(input.preferredInstanceId)
      ? undefined
      : input.preferredInstanceId,
  });
}

export const resolveMtModelForTurnEffect = Effect.fn("resolveMtModelForTurn")(function* (input: {
  readonly stickySelection: ModelSelection;
  readonly prompt: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly snapshots?: ReadonlyArray<AccountLimitsSnapshot>;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly attachmentCount?: number | undefined;
  readonly conversationTurnCount?: number | undefined;
  readonly recentFailureCount?: number | undefined;
  readonly preferredInstanceId?: ModelSelection["instanceId"] | null | undefined;
}) {
  if (!isMtModelSelection(input.stickySelection)) {
    return null;
  }
  const local = classifyMtTurn({
    prompt: input.prompt,
    interactionMode: input.interactionMode,
    attachmentCount: input.attachmentCount,
    conversationTurnCount: input.conversationTurnCount,
    recentFailureCount: input.recentFailureCount,
  });
  const remote = yield* Effect.serviceOption(MtModelCloudflareClassifier);
  const classified = mergeMtTurnClassifications(
    local,
    Option.isSome(remote)
      ? yield* remote.value.classify({
          prompt: input.prompt,
          interactionMode: input.interactionMode,
        })
      : null,
  );
  return routeMtModel({
    classification: classified,
    mode: parseMtModelRouteMode(input.stickySelection.options),
    candidates: buildMtRouteCandidates(input.providers, input.snapshots ?? []),
    preferredInstanceId: isMtModelInstanceId(input.preferredInstanceId)
      ? undefined
      : input.preferredInstanceId,
  });
});
