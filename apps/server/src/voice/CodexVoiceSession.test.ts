// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - drives a real Codex-shaped child process from a temp dir.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "@effect/vitest";
import { CodexVoiceSession } from "./CodexVoiceSession.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
  mode: string,
  askAgent: (prompt: string, signal: AbortSignal) => Promise<string>,
) {
  const dir = await mkdtemp(join(tmpdir(), "codex-voice-test-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "app-server");
  await writeFile(
    script,
    `
import { createInterface } from 'node:readline';
const send = (v) => process.stdout.write(JSON.stringify(v)+'\\n');
createInterface({input:process.stdin}).on('line', l => {
  const m=JSON.parse(l);
  if(m.method==='initialize') send({id:m.id,result:{}});
  if(m.method==='account/read') send({id:m.id,result:{account:{type:${JSON.stringify(mode === "apikey" ? "apiKey" : "chatgpt")}}}});
  if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'test-thread'}}});
  if(m.method==='thread/realtime/start') {
    send({id:m.id,result:{}});
    if(${JSON.stringify(mode)}==='error') send({method:'thread/realtime/error',params:{message:'Voice entitlement unavailable'}});
    else {
      send({method:'thread/realtime/sdp',params:{sdp:'answer-sdp'}});
      send({id:'tool-1',method:'item/tool/call',params:{tool:'ask_selected_agent',arguments:{prompt:'Ask Claude for the result'}}});
      // GPT-Live repeats the handoff for a single spoken request.
      if(${JSON.stringify(mode)}==='repeat') {
        send({id:'tool-2',method:'item/tool/call',params:{tool:'ask_selected_agent',arguments:{prompt:'Ask Claude for the result'}}});
        send({id:'tool-3',method:'item/tool/call',params:{tool:'ask_selected_agent',arguments:{prompt:'Ask Claude for the result'}}});
      }
    }
  }
  if(m.method==='thread/realtime/stop') process.exit(0);
});
process.stdin.on('end',()=>process.exit(0));
`,
  );
  // Node treats "app-server" as the script, matching the real executable's argv.
  const session = new CodexVoiceSession({
    command: process.execPath,
    args: ["app-server"],
    cwd: dir,
    askAgent,
  });
  cleanups.push(() => session.close());
  return session;
}

it("waits for the SDP notification and routes a tool request to the selected agent", async () => {
  let complete!: (value: string) => void;
  const asked = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const session = await fixture("ok", async (prompt) => {
    complete(prompt);
    return "Claude's answer";
  });
  expect(await session.start("offer-sdp")).toBe("answer-sdp");
  expect(await asked).toBe("Ask Claude for the result");
  expect(session.renew()).toBeUndefined();
  session.close();
  expect(session.renew()).toBe("Voice session ended.");
});

it("runs one turn when GPT-Live repeats a handoff for the same request", async () => {
  let asked = 0;
  let release!: (value: string) => void;
  const answer = new Promise<string>((resolve) => {
    release = resolve;
  });
  const session = await fixture("repeat", async () => {
    asked += 1;
    return answer;
  });
  await session.start("offer-sdp");
  await new Promise((resolve) => setTimeout(resolve, 150));
  release("Claude's answer");
  await answer;
  expect(asked).toBe(1);
});

it("does not mistake an RPC acknowledgement for a working voice connection", async () => {
  const session = await fixture("error", async () => "unused");
  await expect(session.start("offer-sdp")).rejects.toThrow("Voice entitlement unavailable");
});

it("requires ChatGPT login and never silently falls back to paid API authentication", async () => {
  const session = await fixture("apikey", async () => "unused");
  await expect(session.start("offer-sdp")).rejects.toThrow(
    "Sign in to Codex with your ChatGPT account",
  );
});

it("aborts pending handoff waits when voice closes", async () => {
  let received!: (value: AbortSignal) => void;
  const asked = new Promise<AbortSignal>((resolve) => {
    received = resolve;
  });
  const session = await fixture("ok", async (_prompt, signal) => {
    received(signal);
    return new Promise((resolve) =>
      signal.addEventListener("abort", () => resolve("ended"), { once: true }),
    );
  });
  await session.start("offer-sdp");
  const signal = await asked;
  session.close();
  expect(signal.aborted).toBe(true);
});
