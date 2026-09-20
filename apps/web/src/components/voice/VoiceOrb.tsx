import { cn } from "../../lib/utils";

export type VoiceOrbState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "error";

/**
 * The call's one visual. Size and glow follow live loudness; the state only
 * changes colour, so a quiet call sits still instead of pulsing forever.
 */
export function VoiceOrb({
  state,
  level,
  className,
}: {
  readonly state: VoiceOrbState;
  readonly level: number;
  readonly className?: string;
}) {
  const responsive = state === "listening" || state === "speaking";
  const scale = responsive ? 1 + Math.min(level, 1) * 0.18 : 1;
  const glow = responsive ? 0.35 + Math.min(level, 1) * 0.45 : 0.3;

  return (
    <div className={cn("relative flex size-32 items-center justify-center", className)}>
      <div
        className={cn(
          "absolute inset-0 rounded-full blur-2xl transition-opacity duration-300",
          state === "error" ? "bg-destructive/50" : "bg-primary/50",
        )}
        style={{ opacity: glow }}
        aria-hidden
      />
      <div
        className={cn(
          "size-24 rounded-full transition-[transform,background-color] duration-100 ease-out",
          state === "error"
            ? "bg-destructive"
            : state === "muted"
              ? "bg-muted-foreground/60"
              : state === "thinking"
                ? "bg-gradient-to-br from-primary/70 to-primary"
                : "bg-gradient-to-br from-primary to-primary/70",
          state === "thinking" && "animate-pulse",
          state === "connecting" && "opacity-60",
        )}
        style={{ transform: `scale(${scale.toFixed(3)})` }}
        aria-hidden
      />
    </div>
  );
}
