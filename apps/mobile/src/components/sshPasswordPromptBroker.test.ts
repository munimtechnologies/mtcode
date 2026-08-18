import { describe, expect, it } from "@effect/vitest";

import type { SourceControlSshPasswordPromptRequest } from "@t3tools/contracts";

import { createSshPasswordPromptBroker } from "./sshPasswordPromptBroker";

const request = (requestId: string): SourceControlSshPasswordPromptRequest => ({
  requestId,
  destination: "git@github.com:t3tools/t3code.git",
  username: null,
  prompt: "Enter the SSH key passphrase or password.",
  attempt: 1,
  expiresAt: "2026-08-17T10:00:00.000Z",
});

describe("mobile SSH password prompt broker", () => {
  it("queues prompts from independent operations", async () => {
    const broker = createSshPasswordPromptBroker();
    let currentRequestId: string | null = null;
    const presentedRequestIds: Array<string | null> = [];
    broker.subscribe((current) => {
      currentRequestId = current?.requestId ?? null;
      presentedRequestIds.push(currentRequestId);
    });
    const firstSession = broker.createSession();
    const secondSession = broker.createSession();

    const firstPassword = firstSession.request(request("first"));
    const secondPassword = secondSession.request(request("second"));

    expect(currentRequestId).toBe("first");
    expect(presentedRequestIds).toEqual([null, "first"]);
    broker.resolveCurrent("first", "first secret");
    await expect(firstPassword).resolves.toBe("first secret");
    expect(currentRequestId).toBe("second");
    broker.resolveCurrent("second", "second secret");
    await expect(secondPassword).resolves.toBe("second secret");
  });

  it("does not cancel a newer operation when an older operation cleans up", async () => {
    const broker = createSshPasswordPromptBroker();
    let currentRequestId: string | null = null;
    broker.subscribe((current) => {
      currentRequestId = current?.requestId ?? null;
    });
    const cloneSession = broker.createSession();
    const gitSession = broker.createSession();

    const clonePassword = cloneSession.request(request("clone"));
    broker.resolveCurrent("clone", "clone secret");
    await expect(clonePassword).resolves.toBe("clone secret");

    const gitPassword = gitSession.request(request("git"));
    cloneSession.cancel();

    expect(currentRequestId).toBe("git");
    broker.resolveCurrent("git", "git secret");
    await expect(gitPassword).resolves.toBe("git secret");
  });

  it("cancels only prompts owned by the session", async () => {
    const broker = createSshPasswordPromptBroker();
    let currentRequestId: string | null = null;
    broker.subscribe((current) => {
      currentRequestId = current?.requestId ?? null;
    });
    const firstSession = broker.createSession();
    const secondSession = broker.createSession();

    const firstPassword = firstSession.request(request("first"));
    const secondPassword = secondSession.request(request("second"));
    secondSession.cancel();

    await expect(secondPassword).resolves.toBeNull();
    expect(currentRequestId).toBe("first");
    broker.resolveCurrent("first", "first secret");
    await expect(firstPassword).resolves.toBe("first secret");
  });
});
