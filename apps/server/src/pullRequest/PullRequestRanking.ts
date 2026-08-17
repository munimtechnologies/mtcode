import type { ModelSelection, PullRequestRanking } from "@t3tools/contracts";
import { PullRequestOperationError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";

/**
 * How many pull requests are judged in one prompt. The whole set is ranked however long it is —
 * a reader asking what to port does not want the tail silently dropped — so a long backlog is
 * split rather than truncated.
 *
 * Kept small because the answer has to survive a round trip through an agent CLI as structured
 * JSON, and the longer the array the more ways that goes wrong — a truncated or reshaped reply
 * fails the whole batch. A smaller batch also means one bad reply costs less of the answer.
 */
const RANKING_BATCH_SIZE = 20;

/**
 * Batches run one after another rather than at once: they go to the same agent CLI, and firing a
 * dozen subprocesses at one model buys nothing but rate limiting.
 */
const RANKING_BATCH_CONCURRENCY = 1;

/**
 * How long a judgement about one pull request is kept. Long, because what a change does only
 * changes when the change does: the entry is keyed by the title it was judged on, so an edited
 * pull request misses the cache and is judged again on its own.
 */
const RANKING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Bounded so a workspace watching a busy upstream for weeks cannot grow this without limit. */
const RANKING_CACHE_CAPACITY = 2_000;

/**
 * Keyed by what was actually judged rather than by the request: the page re-asks whenever any row
 * in the upstream moves, and without this every one of those asks was a fresh model call over
 * rows that had already been scored — which is what made ranking feel like it ran constantly.
 *
 * The model is part of the key because the judgement is the model's, not the repository's. Two
 * agents rank the same backlog differently, and that difference is the reason to switch — so a
 * switch has to show the new model's opinion rather than reuse the old one's. Each keeps its own
 * answers, so switching back is free and switching to something never used ranks afresh.
 */
const rankingCacheKey = (
  repository: string,
  model: ModelSelection,
  candidate: { number: number; title: string },
) =>
  `${model.instanceId}/${model.model}\u0000${repository}#${candidate.number}\u0000${candidate.title}`;

function chunk<A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> {
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Where the pull requests are read from and written into, resolved by the caller. Ranking takes
 * this rather than a project reference so it depends on nothing but an agent: the check that a
 * project may read a repository belongs to the service that owns projects, and doing it here
 * would tie the two together across layers that are built at different levels.
 */
export interface PullRequestRankRequest {
  /** A checkout on the host, which is what the agent CLI is run in. */
  readonly cwd: string;
  readonly repository: string;
  /** What the changes would be ported into, named for the model rather than addressed. */
  readonly intoRepository: string;
  readonly candidates: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly labels?: ReadonlyArray<string> | undefined;
    readonly changedFiles?: number | undefined;
  }>;
  readonly modelSelection: ModelSelection;
}

export class PullRequestRankingService extends Context.Service<
  PullRequestRankingService,
  {
    /** Score a repository's pull requests by how much each is worth porting into the project. */
    readonly rank: (
      input: PullRequestRankRequest,
    ) => Effect.Effect<ReadonlyArray<PullRequestRanking>, PullRequestOperationError>;
  }
>()("t3/pullRequest/PullRequestRanking/PullRequestRankingService") {}

export const make = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration.TextGeneration;

  const cache = new Map<string, { readonly at: number; readonly ranking: PullRequestRanking }>();

  const rememberRanking = (key: string, ranking: PullRequestRanking, at: number) => {
    // Re-inserted so the map's own insertion order doubles as recency for the eviction below.
    cache.delete(key);
    cache.set(key, { at, ranking });
    while (cache.size > RANKING_CACHE_CAPACITY) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  };

  const rank: PullRequestRankingService["Service"]["rank"] = (input) =>
    Effect.gen(function* () {
      if (input.candidates.length === 0) {
        return [];
      }
      const asked = new Set(input.candidates.map((candidate) => candidate.number));
      const now = yield* Clock.currentTimeMillis;

      // Only what has not been judged yet reaches the agent. A page that reloads, or that moves
      // because one pull request was updated, costs nothing for the rows already scored.
      const held: Array<PullRequestRanking> = [];
      const unjudged: Array<(typeof input.candidates)[number]> = [];
      for (const candidate of input.candidates) {
        const key = rankingCacheKey(input.repository, input.modelSelection, candidate);
        const entry = cache.get(key);
        if (entry !== undefined && now - entry.at <= RANKING_CACHE_TTL_MS) {
          held.push(entry.ranking);
          continue;
        }
        if (entry !== undefined) cache.delete(key);
        unjudged.push(candidate);
      }

      if (unjudged.length === 0) {
        return held;
      }

      const batches = chunk(unjudged, RANKING_BATCH_SIZE);
      const ranked = yield* Effect.forEach(
        batches,
        (batch) =>
          textGeneration
            .rankPullRequests({
              cwd: input.cwd,
              repository: input.repository,
              intoRepository: input.intoRepository,
              candidates: batch.map((candidate) => ({
                number: candidate.number,
                title: candidate.title,
                ...(candidate.labels === undefined ? {} : { labels: candidate.labels }),
                ...(candidate.changedFiles === undefined
                  ? {}
                  : { changedFiles: candidate.changedFiles }),
              })),
              modelSelection: input.modelSelection,
            })
            .pipe(
              Effect.map((result) => result.rankings),
              // A batch the agent could not answer costs its own rows and no more: the sections
              // it did rank are still worth showing, and an unscored row simply sorts last.
              Effect.orElseSucceed(() => [] as ReadonlyArray<PullRequestRanking>),
            ),
        { concurrency: RANKING_BATCH_CONCURRENCY },
      );

      const byNumber = new Map(input.candidates.map((candidate) => [candidate.number, candidate]));
      const seen = new Set<number>();
      const rankings: Array<PullRequestRanking> = [...held];
      for (const ranking of held) seen.add(ranking.number);
      for (const ranking of ranked.flat()) {
        // Only rows that were asked about: a model answering for a pull request nobody named has
        // invented it, and the page would key the score to nothing.
        if (!asked.has(ranking.number) || seen.has(ranking.number)) continue;
        seen.add(ranking.number);
        rankings.push(ranking);
        const candidate = byNumber.get(ranking.number);
        if (candidate !== undefined) {
          rememberRanking(
            rankingCacheKey(input.repository, input.modelSelection, candidate),
            ranking,
            now,
          );
        }
      }

      if (rankings.length === 0) {
        return yield* new PullRequestOperationError({
          operation: "rank",
          detail: "The pull requests could not be ranked.",
        });
      }
      return rankings;
    });

  return { rank } satisfies PullRequestRankingService["Service"];
});

export const layer = Layer.effect(PullRequestRankingService, make);
