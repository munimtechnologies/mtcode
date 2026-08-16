import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));

import { PullRequestCodeBootstrapBody, shouldRefreshAppliedCommitDiff } from "./PullRequestCodeTab";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";

describe("PullRequestCodeBootstrapBody", () => {
  it("keeps initial aggregate loading in the diff body", () => {
    const markup = renderToStaticMarkup(
      <PullRequestCodeBootstrapBody error={null} onRetry={() => {}} />,
    );

    expect(markup).toContain("Loading pull request diff...");
    expect(markup).not.toContain("Could not load pull request diff");
  });

  it("uses the diff-specific failure title and wires retry", () => {
    const onRetry = vi.fn();
    const body = PullRequestCodeBootstrapBody({ error: "GitHub did not answer.", onRetry });

    expect(isValidElement(body)).toBe(true);
    const unavailable = body as ReactElement<
      ComponentProps<typeof PullRequestsUnavailableState>,
      typeof PullRequestsUnavailableState
    >;
    expect(unavailable.type).toBe(PullRequestsUnavailableState);
    expect(unavailable.props.title).toBe("Could not load pull request diff");
    expect(unavailable.props.error).toBe("GitHub did not answer.");
    expect(unavailable.props.onRetry).toBe(onRetry);

    const markup = renderToStaticMarkup(body);
    expect(markup).toContain("Could not load pull request diff");
    expect(markup).toContain("GitHub did not answer.");
    expect(markup).toContain("Retry");
  });
});

describe("shouldRefreshAppliedCommitDiff", () => {
  it("refreshes the same selected commit for a later applied snapshot", () => {
    expect(
      shouldRefreshAppliedCommitDiff(
        { version: 1, commit: "commit-a" },
        { version: 2, commit: "commit-a" },
      ),
    ).toBe(true);
  });

  it("leaves a changed commit to its newly mounted query", () => {
    expect(
      shouldRefreshAppliedCommitDiff(
        { version: 1, commit: "commit-a" },
        { version: 2, commit: "commit-b" },
      ),
    ).toBe(false);
  });

  it("leaves the first snapshot to its newly mounted query", () => {
    expect(
      shouldRefreshAppliedCommitDiff(
        { version: null, commit: "commit-a" },
        { version: 1, commit: "commit-a" },
      ),
    ).toBe(false);
  });
});
