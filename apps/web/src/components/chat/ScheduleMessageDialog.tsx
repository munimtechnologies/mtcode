import { CalendarClockIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  defaultScheduledMessageInputValue,
  resolveScheduledSendInstant,
  toLocalDateTimeInputValue,
} from "./scheduleMessage";

export function ScheduleMessageDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSchedule: (scheduledFor: string) => void;
}) {
  const { open, onOpenChange, onSchedule } = props;
  const [localDateTime, setLocalDateTime] = useState(() => defaultScheduledMessageInputValue());
  const [error, setError] = useState<string | null>(null);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  useEffect(() => {
    if (!open) return;
    setLocalDateTime(defaultScheduledMessageInputValue());
    setError(null);
  }, [open]);

  const submit = () => {
    const result = resolveScheduledSendInstant(localDateTime);
    if (result.error !== null || result.scheduledFor === null) {
      setError(result.error ?? "Choose a valid date and time.");
      return;
    }
    onSchedule(result.scheduledFor);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-muted/60">
            <CalendarClockIcon aria-hidden className="size-4.5 text-muted-foreground" />
          </div>
          <DialogTitle>Schedule send</DialogTitle>
          <DialogDescription>
            The message waits in this thread's queue and goes out at the chosen time. If the agent
            is busy then, it goes out when the current turn ends.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          <label className="grid gap-2 text-sm font-medium" htmlFor="scheduled-message-time">
            Send on
            <Input
              id="scheduled-message-time"
              nativeInput
              type="datetime-local"
              min={toLocalDateTimeInputValue(new Date(Date.now() + 60_000))}
              value={localDateTime}
              onChange={(event) => {
                setLocalDateTime(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              aria-invalid={error !== null}
            />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">{timeZone}</p>
          {error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
