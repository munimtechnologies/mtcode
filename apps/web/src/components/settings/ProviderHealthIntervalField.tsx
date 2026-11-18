import * as Duration from "effect/Duration";
import { useState } from "react";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import {
  normalizeProviderHealthIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
} from "./SettingsPanels.logic";

interface ProviderHealthIntervalFieldProps {
  readonly valueSeconds: number;
  readonly labels: {
    readonly decrease: string;
    readonly input: string;
    readonly increase: string;
  };
  readonly onCommit: (interval: Duration.Duration) => void;
}

/**
 * Keeps typing local and normalizes on commit (blur, Enter, or a stepper
 * click), so a partially typed value below the minimum is never persisted as
 * "disabled" mid-edit. An empty field reverts to the saved value instead of
 * committing, which also keeps a stepper press on a cleared field to a single
 * commit.
 */
export function ProviderHealthIntervalField({
  valueSeconds,
  labels,
  onCommit,
}: ProviderHealthIntervalFieldProps) {
  const [draft, setDraft] = useState<number | null>(valueSeconds);
  const [savedSeconds, setSavedSeconds] = useState(valueSeconds);
  if (savedSeconds !== valueSeconds) {
    setSavedSeconds(valueSeconds);
    setDraft(valueSeconds);
  }

  return (
    <NumberField
      value={draft}
      min={0}
      step={PROVIDER_HEALTH_INTERVAL_STEP_SECONDS}
      size="sm"
      className="w-32"
      onValueChange={setDraft}
      onValueCommitted={(next) => {
        if (next === null) {
          setDraft(valueSeconds);
          return;
        }
        const seconds = normalizeProviderHealthIntervalSeconds(next, valueSeconds);
        setDraft(seconds);
        if (seconds !== valueSeconds) onCommit(Duration.seconds(seconds));
      }}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label={labels.decrease} />
        <NumberFieldInput aria-label={labels.input} />
        <NumberFieldIncrement aria-label={labels.increase} />
      </NumberFieldGroup>
    </NumberField>
  );
}
