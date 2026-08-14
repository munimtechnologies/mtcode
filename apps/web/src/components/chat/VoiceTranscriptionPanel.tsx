import { ArrowUpIcon, LoaderCircleIcon, SquareIcon, XIcon } from "lucide-react";

import type { VoiceTranscriptionStatus } from "../../hooks/useVoiceTranscription";
import { Button } from "../ui/button";

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceTranscriptionPanel({
  status,
  elapsedMs,
  levels,
  sendDisabled,
  onCancel,
  onStop,
  onSend,
}: {
  readonly status: Exclude<VoiceTranscriptionStatus, "idle">;
  readonly elapsedMs: number;
  readonly levels: readonly number[];
  readonly sendDisabled: boolean;
  readonly onCancel: () => void;
  readonly onStop: () => void;
  readonly onSend: () => void;
}) {
  const waveformPath = levels
    .map((level, index) => {
      if (level <= 0.01) return "";
      const amplitude = Math.max(1.75, level * 14);
      return `M ${index + 0.5} ${16 - amplitude} V ${16 + amplitude}`;
    })
    .join(" ");

  if (status === "transcribing") {
    return (
      <div
        className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-label="Processing recording"
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 rounded-full text-muted-foreground"
          onClick={onCancel}
          aria-label="Cancel transcription"
        >
          <XIcon className="size-4" />
        </Button>
        <LoaderCircleIcon className="size-4 animate-spin" />
        Processing recording…
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      role="status"
      aria-label="Voice recording in progress"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="shrink-0 rounded-full text-muted-foreground"
        onClick={onCancel}
        aria-label="Cancel dictation"
      >
        <XIcon className="size-4" />
      </Button>
      <svg
        className="h-8 min-w-0 flex-1 overflow-hidden text-foreground/75"
        viewBox={`0 0 ${levels.length} 32`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1="0"
          x2={levels.length}
          y1="16"
          y2="16"
          stroke="currentColor"
          strokeDasharray="2 4"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="text-muted-foreground/55"
        />
        <path
          d={waveformPath}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {formatElapsed(elapsedMs)}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="secondary"
        className="shrink-0 rounded-full"
        onClick={onStop}
        aria-label="Stop dictation"
      >
        <SquareIcon className="size-3 fill-current" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        disabled={sendDisabled}
        className="shrink-0 rounded-full"
        onClick={onSend}
        aria-label="Transcribe and send"
      >
        <ArrowUpIcon className="size-4" />
      </Button>
    </div>
  );
}
