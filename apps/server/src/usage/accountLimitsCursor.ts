/**
 * Cursor account limits via the dashboard usage-summary API.
 *
 * Cursor does not stream `account.rate-limits.updated` the way Claude and
 * Codex do. The monthly Auto / API pools live on the same dashboard the CSV
 * export already uses, authenticated with the desktop session in
 * `state.vscdb`.
 *
 * @module accountLimitsCursor
 */
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import * as Effect from "effect/Effect";

import {
  cursorSnapshotFromUnknown,
  type CursorRateLimitsSnapshot,
} from "./accountLimitsNormalize.ts";
import { readLocalCursorExportAuth, withCursorDashboardAuth } from "./usageCursorExport.ts";

const CURSOR_USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";

export type CursorLimitsLoadResult =
  | {
      readonly status: "ok";
      readonly snapshot: CursorRateLimitsSnapshot;
    }
  | {
      readonly status: "missing" | "failed";
      readonly message: string;
    };

/**
 * Pulls the signed-in Cursor account's current billing-cycle limits.
 * Soft-fails when desktop is not signed in or the dashboard is unreachable.
 */
export function loadCursorAccountLimits(options: {
  readonly homeDir?: string;
}): Effect.Effect<CursorLimitsLoadResult, never, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const auth = readLocalCursorExportAuth(options.homeDir);
    if (auth === null) {
      return {
        status: "missing" as const,
        message:
          "Cursor desktop is not signed in on this environment (state.vscdb access token missing).",
      };
    }

    const request = withCursorDashboardAuth(
      HttpClientRequest.get(CURSOR_USAGE_SUMMARY_URL),
      auth.sessionToken,
    );

    const fetched = yield* httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(15_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );

    const snapshot = fetched === null ? null : cursorSnapshotFromUnknown(fetched);
    if (snapshot === null || snapshot.windows.length === 0) {
      return {
        status: "failed" as const,
        message: "Cursor usage summary could not be fetched.",
      };
    }

    return { status: "ok" as const, snapshot };
  });
}
