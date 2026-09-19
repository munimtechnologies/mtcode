import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useLocation, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { resolveShortcutCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import {
  resolveNextAttentionThreadKey,
  resolveThreadAttention,
  sortAttentionItems,
  type ThreadAttentionItem,
} from "../attentionQueue";
import { primaryServerKeybindingsAtom } from "~/state/server";

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function threadKeyFor(shell: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id));
}

function attentionItemsForThreads(
  threads: readonly EnvironmentThreadShell[],
  lastVisitedAtById: Readonly<Record<string, string>>,
  acknowledgedById: Readonly<Record<string, string>>,
): ThreadAttentionItem[] {
  return sortAttentionItems(
    threads.flatMap((thread) => {
      const threadKey = threadKeyFor(thread);
      const item = resolveThreadAttention({
        thread,
        threadKey,
        lastVisitedAt: lastVisitedAtById[threadKey],
        acknowledgedAttentionKey: acknowledgedById[threadKey],
      });
      return item ? [item] : [];
    }),
  );
}

export function ThreadAttentionQueue() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const threads = useThreadShells();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const acknowledgedById = useUiStateStore((state) => state.threadAttentionAcknowledgedById);
  const acknowledgeThreadAttention = useUiStateStore((state) => state.acknowledgeThreadAttention);
  const currentThreadKey =
    routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
  const attentionItems = useMemo(
    () => attentionItemsForThreads(threads, lastVisitedAtById, acknowledgedById),
    [acknowledgedById, lastVisitedAtById, threads],
  );
  const attentionItemsByKey = useMemo(
    () => new Map(attentionItems.map((item) => [item.threadKey, item] as const)),
    [attentionItems],
  );

  const openAttentionItem = useCallback(
    (item: ThreadAttentionItem) => {
      acknowledgeThreadAttention(item.threadKey, item.attentionKey);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(item.thread.environmentId, item.thread.id)),
      });
    },
    [acknowledgeThreadAttention, navigate],
  );

  useEffect(() => {
    if (pathname.startsWith("/settings") || routeTarget?.kind !== "server") return;
    const item = attentionItemsByKey.get(currentThreadKey ?? "");
    if (item) acknowledgeThreadAttention(item.threadKey, item.attentionKey);
  }, [
    acknowledgeThreadAttention,
    attentionItemsByKey,
    currentThreadKey,
    pathname,
    routeTarget?.kind,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key === "Unidentified" ||
        isCommandPaletteOpen() ||
        isTerminalFocused() ||
        isTextEntryTarget(event.target) ||
        pathname.startsWith("/settings") ||
        routeTarget?.kind !== "server"
      ) {
        return;
      }
      if (
        resolveShortcutCommand(event, keybindings, {
          context: { terminalFocus: false, terminalOpen: false },
        }) !== "thread.nextAttention"
      ) {
        return;
      }

      const targetKey = resolveNextAttentionThreadKey({
        items: attentionItems,
        currentThreadKey,
      });
      const target = targetKey ? attentionItemsByKey.get(targetKey) : undefined;
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      openAttentionItem(target);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    attentionItems,
    attentionItemsByKey,
    currentThreadKey,
    keybindings,
    openAttentionItem,
    pathname,
    routeTarget?.kind,
  ]);

  return null;
}
