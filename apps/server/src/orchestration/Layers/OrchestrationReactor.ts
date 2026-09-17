import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import * as GoalReactor from "../GoalReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { TurnWatchdogReactor } from "../Services/TurnWatchdogReactor.ts";
import * as ThreadSettlementReactor from "../ThreadSettlementReactor.ts";
import * as UsageLimitResumeReactor from "../UsageLimitResumeReactor.ts";
import * as PullRequestSyncReactor from "../PullRequestSyncReactor.ts";
import * as ThreadPullRequestReactor from "../ThreadPullRequestReactor.ts";
import * as AgentAwarenessRelay from "../../relay/AgentAwarenessRelay.ts";
import * as StorageCleanup from "../../storageCleanup.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const goalReactor = yield* GoalReactor.GoalReactor;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const turnWatchdogReactor = yield* TurnWatchdogReactor;
  const threadSettlementReactor = yield* ThreadSettlementReactor.ThreadSettlementReactor;
  const usageLimitResumeReactor = yield* UsageLimitResumeReactor.UsageLimitResumeReactor;
  const pullRequestSyncReactor = yield* PullRequestSyncReactor.PullRequestSyncReactor;
  const threadPullRequestReactor = yield* ThreadPullRequestReactor.ThreadPullRequestReactor;
  const agentAwarenessRelay = yield* AgentAwarenessRelay.AgentAwarenessRelay;
  const storageCleanup = yield* StorageCleanup.StorageCleanup;

  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(function* () {
    // GoalReactor subscribes to the domain-event stream before the provider
    // reactors unpark at activation, so their startup burst of session-set
    // events cannot slip past its subscription.
    yield* goalReactor.start();
    yield* providerRuntimeIngestion.start();
    yield* providerCommandReactor.start();
    yield* checkpointReactor.start();
    yield* threadDeletionReactor.start();
    yield* turnWatchdogReactor.start();
    yield* threadPullRequestReactor.start();
    yield* threadSettlementReactor.start();
    yield* usageLimitResumeReactor.start();
    yield* pullRequestSyncReactor.start();
    yield* agentAwarenessRelay.start();
    yield* storageCleanup.start();
  });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
