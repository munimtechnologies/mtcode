import type { PullRequestCherryPickResult, SourceControlProviderKind } from "@t3tools/contracts";
import { PullRequestOperationError } from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/**
 * The ref a host publishes a change request's head under, which is what makes taking somebody
 * else's commits possible without write access to the repository they live in.
 *
 * Written as a full `Record` so a new provider fails to compile here rather than silently
 * inheriting GitHub's ref layout: the two hosts that publish one spell it differently, and the
 * two that do not have to say so.
 */
const HEAD_REF_TEMPLATE: Record<SourceControlProviderKind, ((n: number) => string) | null> = {
  github: (n) => `refs/pull/${n}/head`,
  gitlab: (n) => `refs/merge-requests/${n}/head`,
  bitbucket: null,
  "azure-devops": null,
  unknown: null,
};

/**
 * How many commits one pick may carry. A range this long is a branch being merged rather than a
 * change being ported, and every commit in it is another conflict somebody resolves by hand.
 */
const MAX_PICKED_COMMITS = 100;

/** Paths named in the result; the rest are only counted. Mirrors the contract's own bound. */
const MAX_REPORTED_CONFLICT_PATHS = 50;

/** Git allows far more, but a ref path is built from a repository name a host chose. */
const refSafe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^[.-]+/u, "");

export interface PullRequestCherryPickRequest {
  /** The project checkout the commits are taken into — branched from, never written to. */
  readonly cwd: string;
  readonly provider: SourceControlProviderKind;
  /** Where the change request lives, `host` and `owner/name`, resolved by the caller. */
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  /**
   * What the change request targets. It is how the range is found: the commits that are the
   * change are the ones its head has and its base does not.
   */
  readonly baseBranch: string;
  /** The thread the worktree belongs to, where one is open: the setup script needs to know. */
  readonly threadId?: string | undefined;
}

export class PullRequestCherryPickService extends Context.Service<
  PullRequestCherryPickService,
  {
    /**
     * Take a change request's commits onto a fresh branch in a worktree of its own. Conflicts
     * are an outcome rather than a failure — a fork worth porting into has diverged — so the
     * worktree is left in place mid-pick for somebody, or something, to finish.
     */
    readonly cherryPick: (
      input: PullRequestCherryPickRequest,
    ) => Effect.Effect<PullRequestCherryPickResult, PullRequestOperationError>;
  }
>()("t3/pullRequest/PullRequestCherryPick/PullRequestCherryPickService") {}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;

  const fail = (detail: string, cause?: unknown) =>
    new PullRequestOperationError({
      operation: "cherryPick",
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly allowNonZeroExit?: boolean },
  ) =>
    git
      .execute({
        operation: `PullRequestCherryPick.${operation}`,
        cwd,
        args,
        allowNonZeroExit: options?.allowNonZeroExit ?? false,
        timeoutMs: 120_000,
      })
      .pipe(
        Effect.mapError((error) =>
          fail(error.detail.trim() || `git ${args[0] ?? ""} failed.`, error),
        ),
      );

  const stdoutLines = (stdout: string) =>
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  /**
   * Where to fetch the change request's head from. A remote already pointing at the repository
   * is preferred over a URL built from the host: it is the address this checkout is known to
   * reach, with whatever credentials, protocol and proxying the developer set up for it — a
   * derived HTTPS URL is only the best guess for a repository nothing here has ever talked to.
   */
  const resolveFetchSource = Effect.fn("PullRequestCherryPick.resolveFetchSource")(function* (
    cwd: string,
    host: string,
    repository: string,
  ) {
    const wanted = `${host}/${repository}`.toLowerCase();
    const remotes = yield* run("listRemotes", cwd, ["remote", "-v"]).pipe(
      Effect.map((result) => result.stdout),
      Effect.orElseSucceed(() => ""),
    );
    for (const line of stdoutLines(remotes)) {
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/u.exec(line);
      const url = match?.[2];
      if (url !== undefined && normalizeGitRemoteUrl(url) === wanted) {
        return url;
      }
    }
    return `https://${host}/${repository}.git`;
  });

  /**
   * The commits that are the change, oldest first, with merges left out — a merge in the range
   * only carries the base branch's own commits, which this checkout either already has or does
   * not want, and cherry-picking one is an error rather than a port.
   */
  const resolveCommits = Effect.fn("PullRequestCherryPick.resolveCommits")(function* (
    input: PullRequestCherryPickRequest,
  ) {
    const template = HEAD_REF_TEMPLATE[input.provider];
    if (template === null) {
      return yield* fail(
        "This host does not publish a change request's commits to fetch, so they cannot be cherry-picked. Implement the change instead.",
      );
    }
    const source = yield* resolveFetchSource(input.cwd, input.host, input.repository);
    const namespace = `refs/t3code/cherry-pick/${refSafe(input.repository)}/${input.number}`;
    const headRef = `${namespace}/head`;
    const baseRef = `${namespace}/base`;
    // Both refs in one fetch, into this repository's own namespace rather than into branches:
    // the refs are shared by every worktree, and a branch would collide with whatever the
    // developer already has checked out under that name.
    yield* run("fetch", input.cwd, [
      "fetch",
      "--quiet",
      "--no-tags",
      source,
      `+${template(input.number)}:${headRef}`,
      `+refs/heads/${input.baseBranch}:${baseRef}`,
    ]).pipe(
      Effect.mapError(() =>
        fail(
          `Could not fetch #${input.number} and its base branch \`${input.baseBranch}\` from ${input.repository}. The base branch may have been deleted, which leaves no way to tell which commits are the change request's own.`,
        ),
      ),
    );

    const mergeBase = yield* run("mergeBase", input.cwd, ["merge-base", baseRef, headRef]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.mapError(() =>
        fail(
          `#${input.number} shares no history with \`${input.baseBranch}\`, so which commits are its own cannot be worked out.`,
        ),
      ),
    );

    // `git cherry`, not `rev-list`: the range says which commits are the change request's own,
    // and this says which of those this checkout has not already got. It compares by patch rather
    // than by identity, so a change taken any other way — merged upstream, picked here before,
    // written by hand — counts as had, and pressing the button twice picks nothing the second
    // time. Merge commits are left out with it: one only carries the base branch's own work.
    const commits = yield* run("cherry", input.cwd, ["cherry", "HEAD", headRef, mergeBase]).pipe(
      Effect.map((result) =>
        stdoutLines(result.stdout).flatMap((line) => {
          const [mark, sha] = line.split(/\s+/u);
          return mark === "+" && sha !== undefined ? [sha] : [];
        }),
      ),
    );

    if (commits.length > MAX_PICKED_COMMITS) {
      return yield* fail(
        `#${input.number} carries ${commits.length.toLocaleString()} commits, past the ${MAX_PICKED_COMMITS} this can pick. Merge the branch, or implement the change instead.`,
      );
    }
    return commits;
  });

  /** A branch name nothing has taken, so a second attempt at the same change request is its own. */
  const resolveBranchName = Effect.fn("PullRequestCherryPick.resolveBranchName")(function* (
    cwd: string,
    desired: string,
  ) {
    const taken = yield* run("listBranches", cwd, [
      "for-each-ref",
      "--format=%(refname:short)",
      `refs/heads/${desired}`,
      `refs/heads/${desired}-*`,
    ]).pipe(
      Effect.map((result) => new Set(stdoutLines(result.stdout))),
      Effect.orElseSucceed(() => new Set<string>()),
    );
    if (!taken.has(desired)) return desired;
    for (let suffix = 2; suffix <= 100; suffix += 1) {
      const candidate = `${desired}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    return yield* fail(`There are already 100 branches named after picking #${desired}.`);
  });

  const cherryPick: PullRequestCherryPickService["Service"]["cherryPick"] = Effect.fn(
    "PullRequestCherryPick.cherryPick",
  )(function* (input) {
    const commits = yield* resolveCommits(input);
    // Nothing to take, and so nothing to leave behind: a worktree holding a branch identical to
    // the one it was cut from is only something to clean up later.
    if (commits.length === 0) {
      return {
        status: "empty" as const,
        worktreePath: null,
        branch: null,
        commits: 0,
        conflictedPaths: [],
        conflictedPathCount: 0,
      };
    }

    const branch = yield* resolveBranchName(input.cwd, `t3code/cherry-pick/pr-${input.number}`);
    // Cut from where the project stands, which is the tree these commits are being ported into.
    // Never checked out here: the developer is working in that tree, and a pick that stops on a
    // conflict would leave it stopped.
    const created = yield* git
      .createWorktree({ cwd: input.cwd, refName: "HEAD", newRefName: branch, path: null })
      .pipe(
        Effect.mapError((error) =>
          fail(error.detail.trim() || `Could not create a worktree for \`${branch}\`.`, error),
        ),
      );
    const worktreePath = created.worktree.path;
    // Best effort, and before the pick rather than after it: a conflicted worktree is one
    // somebody is about to build in, and it should be installing while they read the conflict.
    // A project with no setup script, or one that fails, still gets its commits.
    if (input.threadId !== undefined) {
      yield* projectSetupScriptRunner
        .runForThread({ threadId: input.threadId, projectCwd: input.cwd, worktreePath })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("PullRequestCherryPick setup script failed", {
              threadId: input.threadId,
              worktreePath,
              cause: error,
            }).pipe(Effect.asVoid),
          ),
        );
    }

    // `-x` records where each commit came from, which is the only trace left once the branch is
    // squashed or rebased. Redundant commits are kept rather than stopping the sequence: a
    // change already in this tree is a commit worth nothing, not a pick worth interrupting.
    const picked = yield* run(
      "cherryPick",
      worktreePath,
      ["cherry-pick", "-x", "--keep-redundant-commits", ...commits],
      { allowNonZeroExit: true },
    );
    if (picked.exitCode === 0) {
      return {
        status: "applied" as const,
        worktreePath,
        branch,
        commits: commits.length,
        conflictedPaths: [],
        conflictedPathCount: 0,
      };
    }

    const conflicted = yield* run("conflicts", worktreePath, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]).pipe(
      Effect.map((result) => stdoutLines(result.stdout)),
      Effect.orElseSucceed(() => []),
    );
    if (conflicted.length > 0) {
      return {
        status: "conflicted" as const,
        worktreePath,
        branch,
        commits: commits.length,
        conflictedPaths: conflicted.slice(0, MAX_REPORTED_CONFLICT_PATHS),
        conflictedPathCount: conflicted.length,
      };
    }

    // Stopped for something other than a conflict — a hook, a missing object, a broken index.
    // Nothing here is worth carrying on in, so the pick is undone and the worktree taken back
    // rather than left as a branch nobody asked for.
    yield* run("abort", worktreePath, ["cherry-pick", "--abort"], {
      allowNonZeroExit: true,
    }).pipe(Effect.ignore);
    yield* git
      .removeWorktree({ cwd: input.cwd, path: worktreePath, force: true })
      .pipe(Effect.ignore);
    yield* run("deleteBranch", input.cwd, ["branch", "-D", branch], {
      allowNonZeroExit: true,
    }).pipe(Effect.ignore);
    return yield* fail(
      picked.stderr.trim() || picked.stdout.trim() || `Cherry-picking #${input.number} failed.`,
    );
  });

  return { cherryPick } satisfies PullRequestCherryPickService["Service"];
});

export const layer = Layer.effect(PullRequestCherryPickService, make);
