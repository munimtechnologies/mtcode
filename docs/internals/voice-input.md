# Voice input

Transcription edits a composer draft. It does not submit an agent turn. Audio is
temporary client input, and only normal message submission sends the resulting
text. The current implementation transcribes locally on supported iOS devices;
environment-backed transcription is not implemented.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results.

## Realtime voice sessions

The voice panel is a second, separate path: it holds a live GPT-Live call and
submits agent turns. Spoken requests never reach a provider directly. The
session's only tool hands the request to
[`delegateVoiceRequest`](../../apps/server/src/voice/voiceDelegation.ts), which
dispatches `thread.turn.start` on the task voice started in and waits for that
turn's assistant messages, so the task's own model selection, runtime mode and
approvals decide what happens. Messages are collected per turn id because a
provider can still be flushing the previous turn when the new one starts, and an
empty-text `thread.message-sent` is a streamed message's final marker, not its
body — overwriting the collected text with it loses the answer.

GPT-Live raises the same question two or three times, worded slightly
differently and delivered one at a time. Only the first starts a turn: a ping
that lands mid-turn is told to wait, and one that lands just after an answer is
handed that answer back. Refusing them as "already working" only made GPT-Live
retry harder.

The answer does not ride back on the tool call — GPT-Live does not reliably
speak a tool result in this mode, with or without its own `delegationAckFiller`.
The tool call is acknowledged immediately and the agent's reply is pushed into
the live call with `thread/realtime/appendSpeech`, which it does speak.

With the Codex account connection the browser never holds a credential: the
offer/answer exchange goes through the server, which runs
[`CodexVoiceSession`](../../apps/server/src/voice/CodexVoiceSession.ts) against
the user's authenticated Codex install and refuses anything but a ChatGPT login,
so voice cannot silently fall back to a billed API key. Carry the SDP verbatim
over the wire — trimming it strips the CRLF that closes the last line, and the
answering server rejects the body as truncated.
