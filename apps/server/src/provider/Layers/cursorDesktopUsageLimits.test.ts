import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  CURSOR_NOT_SIGNED_IN_MESSAGE,
  CURSOR_UNLIMITED_PLAN_MESSAGE,
  CURSOR_USAGE_FETCH_FAILED_MESSAGE,
  CURSOR_USAGE_SUMMARY_URL,
  CURSOR_USAGE_UNEXPECTED_SHAPE_MESSAGE,
  cursorPlanNameFromUsageSummary,
  cursorUsageSummaryToLimits,
  loadCursorUsageLimits,
} from "./cursorDesktopUsageLimits.ts";

const checkedAt = "2026-09-16T10:00:00.000Z";

/** `GET /api/usage-summary` as the dashboard returns it for a Pro seat. */
const usageSummaryFixture = {
  billingCycleStart: "2026-09-01T00:00:00.000Z",
  billingCycleEnd: "2026-10-01T00:00:00.000Z",
  membershipType: "pro",
  isUnlimited: false,
  individualUsage: {
    plan: {
      includedSpend: 1250,
      limit: 2000,
      autoPercentUsed: 41.5,
      apiPercentUsed: 12,
      totalPercentUsed: 62.5,
    },
    onDemand: { enabled: true, individualUsed: 300, individualLimit: 1000 },
  },
};

/** `POST /api/dashboard/get-current-period-usage` shape, unix-ms cycle bounds. */
const periodUsageFixture = {
  billingCycleStart: 1_788_220_800_000,
  billingCycleEnd: 1_790_812_800_000,
  planInfo: { planName: "Ultra" },
  planUsage: { totalPercentUsed: 80 },
  spendLimitUsage: { enabled: false, used: 0, limit: 500 },
};

describe("cursorUsageSummaryToLimits", () => {
  it("maps the monthly pools and the on-demand cap onto stable window ids", () => {
    expect(cursorUsageSummaryToLimits({ payload: usageSummaryFixture, checkedAt })).toEqual({
      checkedAt,
      windows: [
        {
          id: "api",
          kind: "monthly",
          label: "API",
          usedPercent: 12,
          resetsAt: "2026-10-01T00:00:00.000Z",
          windowDurationMins: 43_200,
        },
        {
          id: "auto",
          kind: "monthly",
          label: "Auto",
          usedPercent: 41.5,
          resetsAt: "2026-10-01T00:00:00.000Z",
          windowDurationMins: 43_200,
        },
        {
          id: "plan",
          kind: "monthly",
          label: "Monthly",
          usedPercent: 62.5,
          resetsAt: "2026-10-01T00:00:00.000Z",
          windowDurationMins: 43_200,
        },
        {
          id: "on_demand",
          kind: "other",
          label: "On-demand",
          usedPercent: 30,
          resetsAt: "2026-10-01T00:00:00.000Z",
          windowDurationMins: 43_200,
        },
      ],
    });
  });

  it("falls back to the total percentage and skips a disabled on-demand cap", () => {
    expect(cursorUsageSummaryToLimits({ payload: periodUsageFixture, checkedAt })).toEqual({
      checkedAt,
      windows: [
        {
          id: "plan",
          kind: "monthly",
          label: "Monthly",
          usedPercent: 80,
          resetsAt: "2026-10-01T00:00:00.000Z",
          windowDurationMins: 43_200,
        },
      ],
    });
  });

  it("clamps percentages into 0–100", () => {
    const limits = cursorUsageSummaryToLimits({
      payload: {
        billingCycleEnd: "2026-10-01T00:00:00.000Z",
        planUsage: { autoPercentUsed: 140, apiPercentUsed: -3 },
      },
      checkedAt,
    });
    expect(limits.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["api", 0],
      ["auto", 100],
    ]);
  });

  it("reports an unlimited plan as unsupported rather than a fake 0% bar", () => {
    expect(
      cursorUsageSummaryToLimits({
        payload: { ...usageSummaryFixture, isUnlimited: true },
        checkedAt,
      }),
    ).toEqual({
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: CURSOR_UNLIMITED_PLAN_MESSAGE },
    });
  });

  it("treats an unrecognised payload as a failed probe", () => {
    expect(cursorUsageSummaryToLimits({ payload: { hello: "world" }, checkedAt })).toEqual({
      checkedAt,
      windows: [],
      unavailable: { reason: "probeFailed", message: CURSOR_USAGE_UNEXPECTED_SHAPE_MESSAGE },
    });
    expect(cursorUsageSummaryToLimits({ payload: "nope", checkedAt }).unavailable?.reason).toBe(
      "probeFailed",
    );
  });
});

describe("cursorPlanNameFromUsageSummary", () => {
  it("prefers the membership type and capitalises it", () => {
    expect(cursorPlanNameFromUsageSummary(usageSummaryFixture)).toBe("Pro");
    expect(cursorPlanNameFromUsageSummary(periodUsageFixture)).toBe("Ultra");
    expect(cursorPlanNameFromUsageSummary({})).toBeUndefined();
  });
});

describe("loadCursorUsageLimits", () => {
  const auth = { userId: "user_abc", sessionToken: "user_abc%3A%3Ajwt" };

  const clientReturning = (
    respond: (request: HttpClientRequest.HttpClientRequest) => Response,
    onRequest?: (request: HttpClientRequest.HttpClientRequest) => void,
  ) =>
    HttpClient.make((request) =>
      Effect.sync(() => {
        onRequest?.(request);
        return HttpClientResponse.fromWeb(request, respond(request));
      }),
    );

  it.effect("fetches the usage summary with the desktop session cookie", () =>
    Effect.gen(function* () {
      const seen: HttpClientRequest.HttpClientRequest[] = [];
      const limits = yield* loadCursorUsageLimits({ readAuth: () => auth }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          clientReturning(
            () => Response.json(usageSummaryFixture),
            (request) => {
              seen.push(request);
            },
          ),
        ),
      );
      expect(seen.map((request) => request.url)).toEqual([CURSOR_USAGE_SUMMARY_URL]);
      expect(seen[0]?.headers["cookie"]).toBe(`WorkosCursorSessionToken=${auth.sessionToken}`);
      expect(limits.unavailable).toBeUndefined();
      expect(limits.windows.map((window) => window.id)).toEqual([
        "api",
        "auto",
        "plan",
        "on_demand",
      ]);
    }),
  );

  it.effect("reports probeFailed without touching the network when desktop is signed out", () =>
    Effect.gen(function* () {
      let requests = 0;
      const limits = yield* loadCursorUsageLimits({ readAuth: () => null }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          clientReturning(
            () => Response.json({}),
            () => {
              requests += 1;
            },
          ),
        ),
      );
      expect(requests).toBe(0);
      expect(limits).toEqual({
        checkedAt: expect.any(String),
        windows: [],
        unavailable: { reason: "probeFailed", message: CURSOR_NOT_SIGNED_IN_MESSAGE },
      });
    }),
  );

  it.effect("reports probeFailed when the dashboard rejects the session", () =>
    Effect.gen(function* () {
      const limits = yield* loadCursorUsageLimits({ readAuth: () => auth }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          clientReturning(() => new Response("unauthorized", { status: 401 })),
        ),
      );
      expect(limits.unavailable).toEqual({
        reason: "probeFailed",
        message: CURSOR_USAGE_FETCH_FAILED_MESSAGE,
      });
    }),
  );
});
