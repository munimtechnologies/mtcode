import type { DesktopSshPasswordPromptRequest } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { SshPasswordRequestDialog } from "../SshPasswordRequestDialog";

let promptQueue: readonly DesktopSshPasswordPromptRequest[] = [];
const promptQueueListeners = new Set<() => void>();

function setPromptQueue(next: readonly DesktopSshPasswordPromptRequest[]) {
  promptQueue = next;
  for (const listener of promptQueueListeners) listener();
}

/**
 * Queues the desktop's SSH password prompts for the life of the page, so a prompt
 * that arrives while no dialog is mounted still waits for one.
 */
export function startSshPasswordPromptQueue(): () => void {
  const bridge = window.desktopBridge;
  if (!bridge) return () => undefined;
  const stopPrompts = bridge.onSshPasswordPrompt((request) => {
    if (promptQueue.some((queued) => queued.requestId === request.requestId)) return;
    setPromptQueue([...promptQueue, request]);
  });
  const stopSettled = bridge.onSshPasswordPromptSettled(removeSshPasswordPrompt);
  return () => {
    stopPrompts();
    stopSettled();
  };
}

function subscribePromptQueue(listener: () => void): () => void {
  promptQueueListeners.add(listener);
  return () => {
    promptQueueListeners.delete(listener);
  };
}

const readPromptQueue = () => promptQueue;

function removeSshPasswordPrompt(requestId: string) {
  if (!promptQueue.some((request) => request.requestId === requestId)) return;
  setPromptQueue(promptQueue.filter((request) => request.requestId !== requestId));
}

export function SshPasswordPromptDialog() {
  const queue = useSyncExternalStore(subscribePromptQueue, readPromptQueue, readPromptQueue);
  const currentRequest = queue[0] ?? null;

  if (!currentRequest) {
    return null;
  }

  return (
    <SshPasswordRequestDialog
      key={currentRequest.requestId}
      request={currentRequest}
      purpose="connection"
      onRespond={(password) =>
        window.desktopBridge?.resolveSshPasswordPrompt(currentRequest.requestId, password) ??
        Promise.resolve()
      }
      onRemove={removeSshPasswordPrompt}
    />
  );
}
