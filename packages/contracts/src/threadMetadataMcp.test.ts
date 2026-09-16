import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ThreadMetadataMcpUpdateInput } from "./threadMetadataMcp.ts";

const decodeUpdate = Schema.decodeUnknownSync(ThreadMetadataMcpUpdateInput);

describe("ThreadMetadataMcpUpdateInput", () => {
  it("decodes each metadata action with only its required fields", () => {
    assert.deepEqual(decodeUpdate({ action: "rename", title: "Release follow-up" }), {
      action: "rename",
      title: "Release follow-up",
    });
    assert.deepEqual(decodeUpdate({ action: "regenerate_title" }), {
      action: "regenerate_title",
    });
  });

  it("rejects missing action data and fields from another action", () => {
    assert.throws(() => decodeUpdate({ action: "rename" }));
    assert.throws(() => decodeUpdate({ action: "regenerate_title", title: "Not allowed" }));
  });

  it("rejects unknown actions, including pull request links owned by the pullRequests toolkit", () => {
    assert.throws(() => decodeUpdate({ action: "move_workspace" }));
    assert.throws(() =>
      decodeUpdate({
        action: "link_pull_request",
        pullRequest: {
          repository: "pingdotgg/t3code",
          number: 8689,
          url: "https://github.com/pingdotgg/t3code/pull/8689",
        },
      }),
    );
    assert.throws(() => decodeUpdate({ action: "unlink_pull_request" }));
  });

  it("rejects malformed client request ids without normalizing valid keys", () => {
    const validKey = "metadata-\ud83d\ude80-1";
    assert.equal(
      decodeUpdate({ action: "regenerate_title", clientRequestId: validKey }).clientRequestId,
      validKey,
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\ud800" }),
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\udc00" }),
    );
  });
});
