import type {
  PullRequestLocalStack,
  PullRequestStackStepState,
  PullRequestStackSummary,
} from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  Clock3Icon,
  GitPullRequestClosedIcon,
  LayersIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

type PullRequestStackPickerInput =
  | {
      readonly kind: "local";
      readonly repository: string;
      readonly stack: PullRequestLocalStack;
    }
  | {
      readonly kind: "remote";
      readonly repository: string;
      readonly stack: PullRequestStackSummary;
      readonly pullRequestNumber: number;
    };

type PickerStepState = PullRequestStackStepState | "unsubmitted";

interface PickerStep {
  readonly position: number;
  readonly branch: string;
  readonly pullRequestNumber: number | null;
  readonly state: PickerStepState;
  readonly current: boolean;
  readonly needsRebase: boolean;
  readonly detail: string;
}

const STATE_LABELS: Record<PickerStepState, string> = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  queued: "Queued",
  unsubmitted: "Not submitted",
};

function stackStepDetail(
  pullRequestNumber: number | null,
  state: PickerStepState,
  repository: string,
  needsRebase: boolean,
) {
  const pullRequest =
    pullRequestNumber === null
      ? STATE_LABELS[state]
      : `#${pullRequestNumber} · ${STATE_LABELS[state]}`;
  return `${pullRequest} · ${repository}${needsRebase ? " · Needs refresh" : ""}`;
}

function buildLocalPickerModel(stack: PullRequestLocalStack, repository: string) {
  const currentPosition = stack.steps.find((step) => step.isCurrent)?.position ?? null;
  const steps = stack.steps.map((step): PickerStep => {
    const pullRequestNumber = step.pullRequest?.number ?? null;
    const state = step.pullRequest?.state ?? "unsubmitted";
    return {
      position: step.position,
      branch: step.branch,
      pullRequestNumber,
      state,
      current: step.isCurrent,
      needsRebase: step.needsRebase,
      detail: stackStepDetail(pullRequestNumber, state, repository, step.needsRebase),
    };
  });
  return { baseBranch: stack.trunk, currentPosition, steps };
}

function buildRemotePickerModel(
  stack: PullRequestStackSummary,
  pullRequestNumber: number,
  repository: string,
) {
  const currentPosition =
    stack.steps.find((step) => step.pullRequestNumber === pullRequestNumber)?.position ?? null;
  const steps = stack.steps.map(
    (step): PickerStep => ({
      position: step.position,
      branch: step.branch,
      pullRequestNumber: step.pullRequestNumber,
      state: step.state,
      current: step.pullRequestNumber === pullRequestNumber,
      needsRebase: false,
      detail: stackStepDetail(step.pullRequestNumber, step.state, repository, false),
    }),
  );
  return { baseBranch: stack.baseBranch, currentPosition, steps };
}

export function buildPullRequestStackPickerModel(input: PullRequestStackPickerInput) {
  return input.kind === "local"
    ? buildLocalPickerModel(input.stack, input.repository)
    : buildRemotePickerModel(input.stack, input.pullRequestNumber, input.repository);
}

function StepIcon({ step }: { step: PickerStep }) {
  const className = "size-3.5 shrink-0";
  if (step.needsRebase) {
    return <TriangleAlertIcon aria-hidden className={cn(className, "text-amber-500")} />;
  }
  if (step.state === "merged") {
    return <CheckCircle2Icon aria-hidden className={cn(className, "text-emerald-500")} />;
  }
  if (step.state === "queued") {
    return <Clock3Icon aria-hidden className={cn(className, "text-blue-500")} />;
  }
  if (step.state === "closed") {
    return <GitPullRequestClosedIcon aria-hidden className={cn(className, "text-red-500")} />;
  }
  if (step.state === "open") {
    return <CircleDotIcon aria-hidden className={cn(className, "text-emerald-500")} />;
  }
  return <span aria-hidden className={cn(className, "rounded-full border border-border")} />;
}

type PullRequestStackPickerProps = PullRequestStackPickerInput & {
  readonly onSelect?: (pullRequestNumber: number) => void;
};

export function PullRequestStackPicker(props: PullRequestStackPickerProps) {
  const model = buildPullRequestStackPickerModel(props);
  if (model.currentPosition === null) return null;
  const staleCount = model.steps.filter((step) => step.needsRebase).length;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Open pull request stack. Step ${model.currentPosition} of ${model.steps.length}.`}
            className="gap-1 px-2"
            size="xs"
            variant="outline"
          />
        }
      >
        <LayersIcon aria-hidden className="size-3.5 text-emerald-500" />
        <span className="tabular-nums">
          {model.currentPosition}/{model.steps.length}
        </span>
        {staleCount > 0 ? (
          <TriangleAlertIcon aria-hidden className="size-3 text-amber-500" />
        ) : null}
        <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-80 max-w-[calc(100vw-1rem)]" side="bottom">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <LayersIcon aria-hidden className="size-4 text-emerald-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Pull request stack</p>
            <p className="truncate text-xs text-muted-foreground">
              {model.steps.length} steps into {model.baseBranch}
            </p>
          </div>
        </div>
        <MenuSeparator />
        <ol className="relative space-y-1 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-border">
          {model.steps.toReversed().map((step) => (
            <li key={step.position} className="relative">
              <MenuItem
                aria-current={step.current ? "step" : undefined}
                disabled={step.pullRequestNumber === null || props.onSelect === undefined}
                onClick={() => {
                  if (step.pullRequestNumber !== null) props.onSelect?.(step.pullRequestNumber);
                }}
                className={cn(
                  "relative flex items-center gap-2 py-2",
                  step.current && "bg-accent/60",
                )}
              >
                <span className="relative z-10 grid size-4 shrink-0 place-items-center bg-popover">
                  <StepIcon step={step} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{step.branch}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {step.detail}
                  </span>
                </span>
              </MenuItem>
            </li>
          ))}
        </ol>
        <MenuSeparator />
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full border border-border bg-background" />
          <span className="min-w-0 flex-1 truncate">{model.baseBranch}</span>
        </div>
      </MenuPopup>
    </Menu>
  );
}
