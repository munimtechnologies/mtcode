import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useStartComputerThread } from "../hooks/useStartComputerThread";
import {
  readProject,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexDraftLanding />;
}

/**
 * Landing on the index route drops straight into a draft. Prefer the most
 * recently active project when one exists; otherwise start on the computer
 * (home directory). The add-project hero is only shown when no environment
 * can host a thread.
 */
function IndexDraftLanding() {
  const router = useRouter();
  // Read at effect time: a deep link can finish navigating before this
  // index effect is flushed, and the rendered pathname would still be "/".
  // This page also stays mounted while a navigation away from "/" is still
  // loading, but the router already points at the new location.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const startComputerThread = useStartComputerThread();
  // One start per attempt; a retry request opens the next attempt.
  const startedAttemptRef = useRef<number | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const mostRecentProject = bootstrapped
    ? (sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null)
    : null;
  const attempt = startState.retryRequest;

  useEffect(() => {
    // Starting a draft after the user has left would replace the page they picked.
    if (!bootstrapped || startedAttemptRef.current === attempt || !isStillOnIndex()) {
      return;
    }
    if (mostRecentProject !== null) {
      const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
      // A project removed since this render is gone from the store; the next
      // render picks another one.
      if (readProject(projectRef) === null) {
        return;
      }
      startedAttemptRef.current = attempt;
      void handleNewThread(projectRef, { replace: true })
        .then((opened) => {
          // The project was removed while its draft started; land on the next one.
          if (opened === null) {
            setStartState((state) => ({ ...state, retryRequest: state.retryRequest + 1 }));
          }
        })
        .catch(() => {
          setStartState((state) => ({ ...state, failed: true }));
        });
      return;
    }
    startedAttemptRef.current = attempt;
    void startComputerThread()
      .then((started) => {
        if (!started) {
          startedAttemptRef.current = null;
        }
      })
      .catch(() => {
        setStartState((state) => ({ ...state, failed: true }));
      });
  }, [attempt, bootstrapped, handleNewThread, mostRecentProject, startComputerThread]);

  if (!bootstrapped) {
    return null;
  }
  if (mostRecentProject !== null) {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  return <NoProjectsHero />;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
