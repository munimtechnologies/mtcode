import type { CodexVoiceSessionInput, CodexVoiceSessionResult, ThreadId } from "@t3tools/contracts";
import {
  OpenAIRealtimeConnection,
  type OpenAIRealtimeDiagnostics,
} from "./OpenAIRealtimeConnection";

type VoiceRpc = (input: CodexVoiceSessionInput) => Promise<CodexVoiceSessionResult>;

export class CodexVoiceConnection {
  private readonly connection = new OpenAIRealtimeConnection();
  private sessionId: string | undefined;
  private stopped = false;
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private readonly rpc: VoiceRpc;
  constructor(rpc: VoiceRpc) {
    this.rpc = rpc;
  }

  async connect(input: {
    threadId: ThreadId;
    inputDeviceId?: string | undefined;
    onEvent: (event: unknown) => void;
    onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  }): Promise<OpenAIRealtimeDiagnostics> {
    const diagnostics = await this.connection.connect({
      onConnectionStateChange: input.onConnectionStateChange,
      onEvent: input.onEvent,
      inputDeviceId: input.inputDeviceId,
      exchangeSdp: async (sdp) => {
        const result = await this.rpc({ action: "start", threadId: input.threadId, sdp });
        this.sessionId = result.sessionId;
        if (this.stopped) {
          await this.rpc({ action: "stop", sessionId: result.sessionId }).catch(() => {});
          throw new Error("Voice session ended.");
        }
        if (!result.sdp)
          throw new Error(result.error ?? "Codex did not return an audio connection.");
        return result.sdp;
      },
    });
    const renew = async () => {
      if (this.stopped || !this.sessionId) return;
      try {
        const result = await this.rpc({ action: "heartbeat", sessionId: this.sessionId });
        if (result.error) throw new Error(result.error);
        if (!this.stopped) this.heartbeat = setTimeout(() => void renew(), 15_000);
      } catch (error) {
        if (this.stopped) return;
        input.onEvent({
          type: "error",
          error: { message: error instanceof Error ? error.message : "Codex voice disconnected." },
        });
        input.onConnectionStateChange("failed");
        this.close();
      }
    };
    void renew();
    return diagnostics;
  }

  // Codex owns GPT-Live's session configuration and backend handoffs.
  send(_value: unknown): void {}
  setMuted(muted: boolean): void {
    this.connection.setMuted(muted);
  }
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.heartbeat);
    this.connection.close();
    if (this.sessionId)
      void this.rpc({ action: "stop", sessionId: this.sessionId }).catch(() => {});
  }
}
