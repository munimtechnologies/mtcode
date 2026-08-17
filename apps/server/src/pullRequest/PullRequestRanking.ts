import type { ModelSelection, PullRequestRanking } from "@t3tools/contracts";
import { PullRequestOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";

/**
 * How many pull requests are judged in one prompt. The whole set is ranked however long it is —
 * a reader asking what to port does not want the tail silently dropped — so a long backlog is
 * split rather than truncated. Sized so a batch still fits comfortably in context alongside the
 * instructions, and so one slow or refused batch costs a slice of the answer rather than all of
 * it.
 */
const RANKING_BATCH_SIZE = 40;

/**
 * Batches run one after another rather than at once: they go to the same agent CLI, and firing a
 * dozen subprocesses at one model buys nothing but rate limiting.
 */
const RANKING_BATCH_CONCURRENCY = 1;

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

  const rank: PullRequestRankingService["Service"]["rank"] = (input) =>
    Effect.gen(function* () {
      if (input.candidates.length === 0) {
        return [];
      }
      const asked = new Set(input.candidates.map((candidate) => candidate.number));
      const batches = chunk(input.candidates, RANKING_BATCH_SIZE);
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

      const seen = new Set<number>();
      const rankings: Array<PullRequestRanking> = [];
      for (const ranking of ranked.flat()) {
        // Only rows that were asked about: a model answering for a pull request nobody named has
        // invented it, and the page would key the score to nothing.
        if (!asked.has(ranking.number) || seen.has(ranking.number)) continue;
        seen.add(ranking.number);
        rankings.push(ranking);
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
