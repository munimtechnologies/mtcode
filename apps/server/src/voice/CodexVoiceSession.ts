// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// This Promise adapter owns a JSON-RPC child and its timers; the enclosing Effect scope closes it.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import * as Schema from "effect/Schema";

const Envelope = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Int, Schema.String])),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
});
const ToolCall = Schema.Struct({ tool: Schema.String, arguments: Schema.Unknown });
const Prompt = Schema.Struct({ prompt: Schema.String });
const Sdp = Schema.Struct({ sdp: Schema.String });
const Failure = Schema.Struct({ message: Schema.String });
const Thread = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) });
const Account = Schema.Struct({
  account: Schema.NullOr(Schema.Struct({ type: Schema.String })),
});

const CODEX_VOICE_INSTRUCTIONS =
  "You are MT Code's voice routing bridge. For every user question or work request, call " +
  "ask_selected_agent with the complete request and relevant spoken context. The selected agent " +
  "owns reasoning, tools, files, and approvals. Never do its work yourself or use other tools. " +
  "Return its result faithfully and concisely. Never claim work succeeded when the tool failed.";

export interface CodexVoiceOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
  readonly cwd: string;
  readonly askAgent: (prompt: string, signal: AbortSignal) => Promise<string>;
}

/** Owns only the child it starts. Credentials stay inside the authenticated Codex runtime. */
export class CodexVoiceSession {
  readonly id = randomUUID();
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly abort = new AbortController();
  private sequence = 0;
  private threadId: string | undefined;
  private closed = false;
  private failure: string | undefined;
  private lease: ReturnType<typeof setTimeout> | undefined;
  private delegation: Promise<string> | undefined;
  private ready: { resolve: (sdp: string) => void; reject: (error: Error) => void } | undefined;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private readonly options: CodexVoiceOptions;

  constructor(options: CodexVoiceOptions) {
    this.options = options;
    this.child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: "pipe",
      windowsHide: true,
    });
    // stderr can contain upstream headers or account details; never forward it to clients.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.fail("The Codex voice connection closed."));
    this.child.on("error", () =>
      this.fail("Could not start Codex. Check the Codex provider's binary path."),
    );
    this.child.on("exit", () => {
      if (!this.closed) this.fail("Codex exited during the voice session.");
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const message = Schema.decodeUnknownSync(Envelope)(JSON.parse(line));
        if (message.method && message.id !== undefined) {
          void this.handleRequest(message.id, message.method, message.params);
        } else if (typeof message.id === "number") {
          const request = this.pending.get(message.id);
          if (!request) return;
          clearTimeout(request.timer);
          this.pending.delete(message.id);
          if (message.error) request.reject(new Error(message.error.message));
          else request.resolve(message.result);
        } else if (message.method === "thread/realtime/sdp") {
          this.ready?.resolve(Schema.decodeUnknownSync(Sdp)(message.params).sdp);
        } else if (message.method === "thread/realtime/error") {
          this.fail(Schema.decodeUnknownSync(Failure)(message.params).message);
        } else if (message.method === "thread/realtime/closed" && !this.closed) {
          this.fail("The Codex voice session ended. Start voice again to reconnect.");
        }
      } catch {
        this.fail("Codex returned an incompatible voice protocol. Update Codex and try again.");
      }
    });
    this.renew();
  }

  private send(value: unknown) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(this.failure ?? "Voice session ended."));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex timed out while handling ${method}.`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  /**
   * GPT-Live can raise several handoffs for one spoken request. One that arrives
   * while the agent is still answering joins that turn instead of being refused
   * as "already working" — being refused is what made it retry harder. A handoff
   * delivered after an answer runs again: by then the words may belong to a new
   * question, and replaying a cached answer would be wrong.
   */
  private ask(prompt: string): Promise<string> {
    if (this.delegation) return this.delegation;
    const delegation = this.options.askAgent(prompt, this.abort.signal);
    this.delegation = delegation;
    void delegation
      .catch(() => undefined)
      .finally(() => {
        if (this.delegation === delegation) this.delegation = undefined;
      });
    return delegation;
  }

  private async handleRequest(id: string | number, method: string, params: unknown) {
    try {
      if (method !== "item/tool/call")
        throw new Error(
          "Use only ask_selected_agent. Approvals belong to the selected MT Code task.",
        );
      const call = Schema.decodeUnknownSync(ToolCall)(params);
      if (call.tool !== "ask_selected_agent") throw new Error("Unknown voice bridge tool.");
      const { prompt } = Schema.decodeUnknownSync(Prompt)(call.arguments);
      if (!prompt.trim() || prompt.length > 32_000)
        throw new Error("The voice request is empty or too long.");
      const text = await this.ask(prompt);
      this.send({ id, result: { success: true, contentItems: [{ type: "inputText", text }] } });
    } catch (error) {
      const text = error instanceof Error ? error.message : "The selected agent could not answer.";
      this.send(
        method === "item/tool/call"
          ? { id, result: { success: false, contentItems: [{ type: "inputText", text }] } }
          : { id, error: { code: -32601, message: text } },
      );
    }
  }

  async start(sdp: string): Promise<string> {
    try {
      await this.request("initialize", {
        clientInfo: { name: "mt_code_voice", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      this.send({ method: "initialized" });
      const account = Schema.decodeUnknownSync(Account)(await this.request("account/read", {}));
      if (account.account?.type !== "chatgpt") {
        throw new Error(
          "Sign in to Codex with your ChatGPT account in Settings → Providers before starting account voice.",
        );
      }
      const thread = Schema.decodeUnknownSync(Thread)(
        await this.request("thread/start", {
          ephemeral: true,
          cwd: this.options.cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          baseInstructions: CODEX_VOICE_INSTRUCTIONS,
          config: { "features.shell_tool": false, web_search: "disabled" },
          dynamicTools: [
            {
              type: "function",
              name: "ask_selected_agent",
              description:
                "Send the user's request to the selected model in the current MT Code task and await its answer.",
              inputSchema: {
                type: "object",
                properties: { prompt: { type: "string" } },
                required: ["prompt"],
                additionalProperties: false,
              },
            },
          ],
        }),
      );
      this.threadId = thread.thread.id;
      const answer = new Promise<string>((resolve, reject) => {
        this.ready = { resolve, reject };
      });
      // Attach the handler before starting: SDP and failures arrive asynchronously after the RPC ack.
      const timeout = setTimeout(
        () => this.fail("Codex did not establish a voice connection in time."),
        35_000,
      );
      try {
        const [, answerSdp] = await Promise.all([
          this.request("thread/realtime/start", {
            threadId: this.threadId,
            outputModality: "audio",
            version: "v3",
            transport: { type: "webrtc", sdp },
            includeStartupContext: false,
            clientManagedHandoffs: false,
            delegationAckFiller: false,
            prompt:
              "You are the voice for the user's selected MT Code agent. Delegate every question and work request to the backend. Speak its result concisely. Never invent its answer or claim work before it finishes.",
          }),
          answer,
        ]);
        return answerSdp;
      } finally {
        clearTimeout(timeout);
        this.ready = undefined;
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  renew(): string | undefined {
    if (this.closed) return this.failure ?? "Voice session ended.";
    clearTimeout(this.lease);
    this.lease = setTimeout(() => this.fail("Voice disconnected from MT Code."), 60_000);
    this.lease.unref();
    return this.failure;
  }

  private fail(message: string) {
    if (this.closed) return;
    this.failure = message;
    this.close();
  }

  close() {
    if (this.closed) return;
    if (this.threadId)
      this.send({
        id: ++this.sequence,
        method: "thread/realtime/stop",
        params: { threadId: this.threadId },
      });
    this.closed = true;
    clearTimeout(this.lease);
    this.abort.abort();
    const error = new Error(this.failure ?? "Voice session ended.");
    this.ready?.reject(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.child.stdin.end();
    const killTimer = setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill();
    }, 2_000);
    killTimer.unref();
    this.child.once("exit", () => clearTimeout(killTimer));
  }
}
