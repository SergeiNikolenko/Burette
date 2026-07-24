import type { ShellActions } from "../components/types";

type WorkspaceHistoryDirection = "undo" | "redo";

let requestSequence = 0;

function nextRequestId() {
  requestSequence += 1;
  return `workspace-history-command-${requestSequence}`;
}

function focusedViewerFrame() {
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement && active.matches(".viewer-iframe")
    ? active
    : null;
}

export function isKetcherWorkspaceTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(".ketcher-page") !== null;
}

export function requestFocusedRuntimeWorkspaceHistory(direction: WorkspaceHistoryDirection, timeoutMs = 160) {
  const iframe = focusedViewerFrame();
  const target = iframe?.contentWindow;
  if (!target) return Promise.resolve(false);
  const requestId = nextRequestId();
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const finish = (handled: boolean) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(handled);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target) return;
      const data = event.data && typeof event.data === "object" ? event.data : null;
      const body = data && "body" in data && data.body && typeof data.body === "object"
        ? data.body as { handled?: unknown; requestId?: unknown; type?: unknown }
        : null;
      if (body?.type !== "workspaceHistoryCommandResult" || body.requestId !== requestId) return;
      finish(body.handled === true);
    };
    window.addEventListener("message", onMessage);
    target.postMessage({
      source: "burette-host",
      body: {
        type: "workspaceHistoryCommand",
        direction,
        requestId,
      },
    }, "*");
  });
}

export async function dispatchWorkspaceHistoryCommand(direction: WorkspaceHistoryDirection, actions: ShellActions) {
  if (await requestFocusedRuntimeWorkspaceHistory(direction)) return true;
  return direction === "undo"
    ? actions.undoWorkspaceAction()
    : actions.redoWorkspaceAction();
}

