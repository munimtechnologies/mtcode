import type { EnvironmentId } from "@t3tools/contracts";

const ADD_STACK_STEP_EVENT = "t3code:add-stack-step";

interface AddStackStepTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export function requestAddStackStep(target: AddStackStepTarget): void {
  window.dispatchEvent(new CustomEvent(ADD_STACK_STEP_EVENT, { detail: target }));
}

export function onAddStackStep(listener: (target: AddStackStepTarget) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AddStackStepTarget>).detail);
  window.addEventListener(ADD_STACK_STEP_EVENT, handler);
  return () => window.removeEventListener(ADD_STACK_STEP_EVENT, handler);
}
