import { RelayApi } from "@t3tools/contracts/relay";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import { HttpClientError } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { relayEnvironmentClient } from "../relay/relayEnvironmentClient.ts";
import * as ServerSettings from "../serverSettings.ts";
import { RELAY_ENVIRONMENT_CREDENTIAL_SECRET, RELAY_URL_SECRET } from "./config.ts";

const retrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(30))),
  ),
  Schedule.upTo({ duration: "10 minutes" }),
);

/**
 * A relay that answers 4xx has given a final answer: the route is missing on
 * the deployed relay (404), or it refuses this environment's credential
 * (401/403). Retrying cannot change any of those, and the schedule above would
 * otherwise spend ten minutes re-asking on every backend start — the label sync
 * runs at startup, so a relay without this route turned every boot into ~34
 * failed requests. Only 408/429 (timeout, rate limit) and 5xx/transport faults
 * are worth another attempt.
 */
export const isRetryableRelayFailure = (error: unknown): boolean => {
  if (!HttpClientError.isHttpClientError(error) || error.response === undefined) {
    // Transport faults and non-HTTP failures stay retryable.
    return true;
  }
  const { status } = error.response;
  if (status === 408 || status === 429) {
    return true;
  }
  return status < 400 || status >= 500;
};

const readSecretString = (secrets: ServerSecretStore.ServerSecretStore["Service"], name: string) =>
  secrets.get(name).pipe(
    Effect.map(
      Option.match({
        onNone: () => null,
        onSome: (bytes) => new TextDecoder().decode(bytes),
      }),
    ),
  );

export const synchronizeCurrentEnvironmentLabelWithRelay = Effect.fn(
  "synchronizeCurrentEnvironmentLabelWithRelay",
)(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const [relayUrl, environmentCredential] = yield* Effect.all([
    readSecretString(secrets, RELAY_URL_SECRET),
    readSecretString(secrets, RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
  ]);
  if (!relayUrl || !environmentCredential) return;

  const descriptor = yield* environment.getDescriptor;
  const client = yield* HttpApiClient.make(RelayApi, {
    baseUrl: relayUrl,
    transformClient: relayEnvironmentClient(environmentCredential),
  });
  yield* client.server.updateEnvironmentLabel({
    params: { environmentId: descriptor.environmentId },
    payload: { label: descriptor.label },
  });
  yield* Effect.logDebug("synchronized environment label with relay", {
    environmentId: descriptor.environmentId,
  });
});

export const runEnvironmentLabelRelaySync = Effect.fn("runEnvironmentLabelRelaySync")(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const settings = yield* ServerSettings.ServerSettingsService;

  const synchronize = Effect.fn("synchronizeEnvironmentLabel")(function* (
    environmentLabel: string,
  ) {
    // Apply the triggering setting before reading the descriptor. The
    // general descriptor watcher runs independently and may not have seen
    // this settings event yet.
    yield* environment.setEnvironmentLabel(environmentLabel);
    yield* synchronizeCurrentEnvironmentLabelWithRelay();
  });

  const changes = yield* settings.subscribeChanges;
  const initialSettings = yield* settings.getSettings;
  const synchronizeWithRetry = (environmentLabel: string) =>
    synchronize(environmentLabel).pipe(
      Effect.retry({ schedule: retrySchedule, while: isRetryableRelayFailure }),
      Effect.catch((cause) =>
        isRetryableRelayFailure(cause)
          ? Effect.logWarning("failed to synchronize environment label with relay", { cause })
          : // Expected against a relay deployment without the label route; the
            // label is cosmetic, so stay quiet rather than warn on every boot.
            Effect.logDebug("relay does not accept environment label updates", { cause }),
      ),
    );

  yield* Stream.concat(
    Stream.make(initialSettings.environmentLabel),
    changes.pipe(
      Stream.map((next) => next.environmentLabel),
      Stream.changes,
    ),
  ).pipe(
    Stream.switchMap((environmentLabel) =>
      Stream.fromEffect(synchronizeWithRetry(environmentLabel)),
    ),
    Stream.runDrain,
  );
});
