import { LoaderCircleIcon, SquareIcon } from "lucide-react";

import type { VoiceTranscriptionStatus } from "../../hooks/useVoiceTranscription";
import { Button } from "../ui/button";

const WAVEFORM_BAR_IDS = Array.from({ length: 36 }, (_, index) => `voice-waveform-${index}`);

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceTranscriptionPanel({
  status,
  elapsedMs,
  levels,
  onStop,
}: {
  readonly status: Exclude<VoiceTranscriptionStatus, "idle">;
  readonly elapsedMs: number;
  readonly levels: readonly number[];
  readonly onStop: () => void;
}) {
  return (
    <div
      className="mx-3 mb-2 flex min-h-12 items-center gap-3 rounded-xl border border-border/55 bg-background/35 px-3"
      role="status"
      aria-label={status === "recording" ? "Voice recording in progress" : "Transcribing voice"}
    >
      {status === "recording" ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-[3px] overflow-hidden"
          aria-hidden="true"
        >
          {WAVEFORM_BAR_IDS.map((id, index) => (
            <span
              key={id}
              className="w-0.5 shrink-0 rounded-full bg-foreground/80 transition-[height] duration-75"
              style={{ height: `${Math.max(4, Math.round((levels[index] ?? 0.1) * 30))}px` }}
            />
          ))}
          <span className="ml-1 h-px min-w-4 flex-1 border-t border-dashed border-muted-foreground/45" />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          transcribing with your configured provider...
        </div>
      )}
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {formatElapsed(elapsedMs)}
      </span>
      {status === "recording" ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="shrink-0 rounded-full"
          onClick={onStop}
          aria-label="Stop dictation"
          title="Stop dictation"
        >
          <SquareIcon className="size-3 fill-current" />
        </Button>
      ) : null}
    </div>
  );
}
