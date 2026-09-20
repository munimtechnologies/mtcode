const DATA_CHANNEL_LABEL = "oai-events";

function booleanSetting(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export interface OpenAIRealtimeDiagnostics {
  readonly inputDevice: string;
  readonly sampleRate: number | null;
  readonly channelCount: number | null;
  readonly echoCancellation: boolean | null;
  readonly noiseSuppression: boolean | null;
  readonly autoGainControl: boolean | null;
  readonly connectionState: RTCPeerConnectionState;
}

export interface OpenAIRealtimeConnectInput {
  readonly clientSecret?: string;
  readonly realtimeUrl?: string;
  readonly exchangeSdp?: (offer: string) => Promise<string>;
  /** Microphone to capture from; the system default when unset. */
  readonly inputDeviceId?: string | undefined;
  readonly onEvent: (event: unknown) => void;
  readonly onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  /** Fires when the far side's audio track arrives, which is after connect resolves. */
  readonly onRemoteStream?: (stream: MediaStream) => void;
}

function waitForDataChannel(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("OpenAI Realtime did not open its event channel in time."));
    }, 15_000);
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("The OpenAI Realtime event channel closed before it was ready."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
    };
    channel.addEventListener("open", handleOpen);
    channel.addEventListener("close", handleClose);
  });
}

export class OpenAIRealtimeConnection {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private inputStream: MediaStream | null = null;
  private outputAudio: HTMLAudioElement | null = null;
  private outputStream: MediaStream | null = null;

  /** Live streams, so the panel can show who is talking. */
  get microphoneStream(): MediaStream | null {
    return this.inputStream;
  }
  get speakerStream(): MediaStream | null {
    return this.outputStream;
  }

  async connect(input: OpenAIRealtimeConnectInput): Promise<OpenAIRealtimeDiagnostics> {
    if (this.peerConnection) throw new Error("OpenAI Realtime is already connected.");

    const peerConnection = new RTCPeerConnection();
    const outputAudio = new Audio();
    outputAudio.autoplay = true;
    outputAudio.setAttribute("playsinline", "true");
    this.peerConnection = peerConnection;
    this.outputAudio = outputAudio;

    peerConnection.addEventListener("connectionstatechange", () => {
      input.onConnectionStateChange(peerConnection.connectionState);
    });
    peerConnection.addEventListener("track", (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.outputStream = stream;
      outputAudio.srcObject = stream;
      input.onRemoteStream?.(stream);
      void outputAudio.play().catch(() => {
        // Autoplay can be delayed until the user interacts with the app. The
        // media element remains attached and the browser retries on later audio.
      });
    });

    const processing = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    // A chosen microphone can be unplugged between sessions, and an exact
    // constraint would then fail the whole call instead of using the default.
    const inputStream = input.inputDeviceId
      ? await navigator.mediaDevices
          .getUserMedia({ audio: { ...processing, deviceId: { exact: input.inputDeviceId } } })
          .catch(() => navigator.mediaDevices.getUserMedia({ audio: processing }))
      : await navigator.mediaDevices.getUserMedia({ audio: processing });
    if (this.peerConnection !== peerConnection) {
      for (const track of inputStream.getTracks()) track.stop();
      throw new Error("Voice session ended.");
    }
    this.inputStream = inputStream;
    const inputTrack = inputStream.getAudioTracks()[0];
    if (!inputTrack) throw new Error("No microphone audio track was available.");
    peerConnection.addTrack(inputTrack, inputStream);

    const dataChannel = peerConnection.createDataChannel(DATA_CHANNEL_LABEL);
    this.dataChannel = dataChannel;
    dataChannel.addEventListener("message", (message) => {
      if (typeof message.data !== "string") return;
      try {
        input.onEvent(JSON.parse(message.data));
      } catch {
        // Ignore malformed provider events without terminating live audio.
      }
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    if (!offer.sdp) throw new Error("OpenAI Realtime could not create a local audio offer.");
    const offerSdp = offer.sdp;
    const answerSdp = input.exchangeSdp
      ? await input.exchangeSdp(offerSdp)
      : await (async () => {
          if (!input.realtimeUrl || !input.clientSecret)
            throw new Error("Missing Realtime credentials.");
          const response = await fetch(input.realtimeUrl, {
            method: "POST",
            headers: {
              authorization: `Bearer ${input.clientSecret}`,
              "content-type": "application/sdp",
            },
            body: offerSdp,
          });
          if (!response.ok)
            throw new Error(
              `OpenAI could not establish the Realtime call (HTTP ${response.status}).`,
            );
          return response.text();
        })();
    if (this.peerConnection !== peerConnection) throw new Error("Voice session ended.");
    await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
    await waitForDataChannel(dataChannel);

    const settings = inputTrack.getSettings();
    return {
      inputDevice: inputTrack.label || "Default microphone",
      sampleRate: settings.sampleRate ?? null,
      channelCount: settings.channelCount ?? null,
      echoCancellation: booleanSetting(settings.echoCancellation),
      noiseSuppression: booleanSetting(settings.noiseSuppression),
      autoGainControl: booleanSetting(settings.autoGainControl),
      connectionState: peerConnection.connectionState,
    };
  }

  send(value: unknown): void {
    if (this.dataChannel?.readyState !== "open") return;
    this.dataChannel.send(JSON.stringify(value));
  }

  setMuted(muted: boolean): void {
    for (const track of this.inputStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  close(): void {
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    for (const track of this.inputStream?.getTracks() ?? []) track.stop();
    this.inputStream = null;
    if (this.outputAudio) {
      this.outputAudio.pause();
      this.outputAudio.srcObject = null;
    }
    this.outputAudio = null;
    this.outputStream = null;
  }
}
