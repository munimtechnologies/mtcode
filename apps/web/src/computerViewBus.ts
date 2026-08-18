// Tiny event bus so the computerView.toggle keybinding (handled in ChatView)
// can drive the viewer dialog without ChatView owning its React state.
const COMPUTER_VIEW_TOGGLE_EVENT = "t3code:toggle-computer-view";

export function toggleComputerView(): void {
  window.dispatchEvent(new CustomEvent(COMPUTER_VIEW_TOGGLE_EVENT));
}

export function onToggleComputerView(listener: () => void): () => void {
  window.addEventListener(COMPUTER_VIEW_TOGGLE_EVENT, listener);
  return () => window.removeEventListener(COMPUTER_VIEW_TOGGLE_EVENT, listener);
}

/** Read at event time so keydown handlers do not subscribe to dialog state. */
export function isComputerViewOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("[data-computer-view]") !== null;
}
