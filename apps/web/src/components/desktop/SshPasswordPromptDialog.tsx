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
  return (
    window.desktopBridge?.onSshPasswordPrompt?.((request) => {
      setPromptQueue([...promptQueue, request]);
    }) ?? (() => undefined)
  );
}

function subscribePromptQueue(listener: () => void): () => void {
  promptQueueListeners.add(listener);
  return () => {
    promptQueueListeners.delete(listener);
  };
}

const readPromptQueue = () => promptQueue;

function removeSshPasswordPrompt(requestId: string) {
  if (promptQueue[0]?.requestId === requestId) setPromptQueue(promptQueue.slice(1));
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
