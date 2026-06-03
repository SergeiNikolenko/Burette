import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { ScrollFade } from "../scroll-fade";
import { hasStructureDrag, readStructureDragPayload, writeStructureDrag } from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import { showNativeContextMenu } from "../native-context-menu";
import { pageKind } from "./page-kinds";
import { isMoleculeCollectionPath } from "../../lib/collection-documents";

const TAB_DRAG_MIME = "application/x-burrete-tab-id";
const TAB_REORDER_ANIMATION_MS = 170;
const TAB_DRAG_ACTIVATE_DELAY_MS = 520;
const TAB_MOUSE_REORDER_THRESHOLD_PX = 8;

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const draggingTabIdRef = useRef<string | null>(null);
  const mouseDragRef = useRef<{ tabId: string; startX: number; active: boolean } | null>(null);
  const removeMouseDragListenersRef = useRef<(() => void) | null>(null);
  const dragActivationRef = useRef<{ tabId: string; timeout: number } | null>(null);
  const tabShellRefs = useRef(new Map<string, HTMLDivElement>());
  const previousTabRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const latestTabsRef = useRef(state.tabs);
  latestTabsRef.current = state.tabs;

  const setTabShellRef = useCallback((tabId: string, node: HTMLDivElement | null) => {
    if (node) {
      tabShellRefs.current.set(tabId, node);
      return;
    }
    tabShellRefs.current.delete(tabId);
  }, []);

  const measureTabRects = useCallback(() => {
    const rects = new Map<string, DOMRect>();
    for (const tab of latestTabsRef.current) {
      const element = tabShellRefs.current.get(tab.id);
      if (element) rects.set(tab.id, element.getBoundingClientRect());
    }
    return rects;
  }, []);

  useLayoutEffect(() => {
    const previousRects = previousTabRectsRef.current;
    if (!previousRects) return;
    previousTabRectsRef.current = null;
    for (const tab of state.tabs) {
      if (tab.id === draggingTabId) continue;
      const element = tabShellRefs.current.get(tab.id);
      const previousRect = previousRects.get(tab.id);
      if (!element || !previousRect) continue;
      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      if (Math.abs(deltaX) < 0.5) continue;
      element.animate(
        [
          { transform: `translateX(${deltaX}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: TAB_REORDER_ANIMATION_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
  }, [state.tabs]);

  const moveDraggedTab = useCallback((tabId: string, pointerX: number) => {
    const orderedTabs = latestTabsRef.current;
    if (orderedTabs.length < 2) return;
    const otherTabs = orderedTabs.filter((tab) => tab.id !== tabId);
    let targetIndex = otherTabs.length;
    for (let index = 0; index < otherTabs.length; index += 1) {
      const element = tabShellRefs.current.get(otherTabs[index].id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (pointerX < rect.left + rect.width / 2) {
        targetIndex = index;
        break;
      }
    }
    const currentIndex = orderedTabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex === targetIndex) return;
    previousTabRectsRef.current = measureTabRects();
    actions.moveTab(tabId, targetIndex);
  }, [actions, measureTabRects]);

  const clearDragActivation = useCallback(() => {
    const activation = dragActivationRef.current;
    if (!activation) return;
    window.clearTimeout(activation.timeout);
    dragActivationRef.current = null;
  }, []);

  const removeMouseDragListeners = useCallback(() => {
    removeMouseDragListenersRef.current?.();
    removeMouseDragListenersRef.current = null;
    mouseDragRef.current = null;
  }, []);

  const scheduleDragActivation = useCallback((tabId: string) => {
    const draggedTabId = draggingTabIdRef.current;
    if (!draggedTabId || tabId === draggedTabId || tabId === state.activeTabId) {
      clearDragActivation();
      return;
    }
    if (dragActivationRef.current?.tabId === tabId) return;
    clearDragActivation();
    dragActivationRef.current = {
      tabId,
      timeout: window.setTimeout(() => {
        dragActivationRef.current = null;
        actions.selectTab(tabId);
      }, TAB_DRAG_ACTIVATE_DELAY_MS),
    };
  }, [actions, clearDragActivation, state.activeTabId]);

  const stopTabDrag = useCallback(() => {
    removeMouseDragListeners();
    clearDragActivation();
    if (draggingTabIdRef.current) actions.setStructureDragActive(false);
    draggingTabIdRef.current = null;
    setDraggingTabId(null);
  }, [actions, clearDragActivation, removeMouseDragListeners]);

  const startMouseTabReorder = useCallback((tabId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    removeMouseDragListeners();
    mouseDragRef.current = { tabId, startX: event.clientX, active: false };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const drag = mouseDragRef.current;
      if (!drag || drag.tabId !== tabId) return;
      if ((moveEvent.buttons & 1) !== 1) {
        stopTabDrag();
        return;
      }
      if (!drag.active) {
        if (Math.abs(moveEvent.clientX - drag.startX) < TAB_MOUSE_REORDER_THRESHOLD_PX) return;
        drag.active = true;
        draggingTabIdRef.current = tabId;
        setDraggingTabId(tabId);
        actions.setStructureDragActive(true);
      }
      moveDraggedTab(tabId, moveEvent.clientX);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopTabDrag, { once: true });
    removeMouseDragListenersRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopTabDrag);
    };
  }, [actions, moveDraggedTab, removeMouseDragListeners, stopTabDrag]);

  useEffect(() => removeMouseDragListeners, [removeMouseDragListeners]);

  const updateNativeTabDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    const tabId = draggingTabIdRef.current;
    if (!tabId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    moveDraggedTab(tabId, event.clientX);
  }, [moveDraggedTab]);

  const handleEmptyTabStripDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    updateNativeTabDrag(event);
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".tab-shell")) return;
    clearDragActivation();
    if (draggingTabIdRef.current || !hasStructureDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, [clearDragActivation, updateNativeTabDrag]);

  const handleEmptyTabStripDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (draggingTabIdRef.current) {
      event.preventDefault();
      event.stopPropagation();
      stopTabDrag();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".tab-shell") || !hasStructureDrag(event.dataTransfer)) return;
    const payload = readStructureDragPayload(event.dataTransfer);
    if (payload.paths.length === 0 && payload.records.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    actions.setStructureDragActive(false);
    const choices = shellDropActionChoices(payload, { kind: "workspace" }, { kind: "tab" });
    runShellDropActionChoices(actions, payload, choices, { x: event.clientX, y: event.clientY });
  }, [actions, stopTabDrag]);

  return (
    <div className="tab-strip" data-tauri-drag-region>
      <div className="tab-history-controls">
        <button
          type="button"
          className="tab-history-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={actions.navigateBack}
          disabled={!actions.canNavigateBack}
          title="Back"
          aria-label="Back"
        >
          ←
        </button>
        <button
          type="button"
          className="tab-history-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={actions.navigateForward}
          disabled={!actions.canNavigateForward}
          title="Forward"
          aria-label="Forward"
        >
          →
        </button>
      </div>
      <ScrollFade
        axis="horizontal"
        className="tab-scroll-region"
        role="tablist"
        aria-label="Open structures"
        data-tauri-drag-region
        onDragOver={handleEmptyTabStripDragOver}
        onDrop={handleEmptyTabStripDrop}
      >
        {state.tabs.map((tab, index) => {
          const kind = pageKind(tab.location);
          const title = kind.title(tab.location, state);
          const active = index === activeTabIndex;
          const fileLocation = tab.location.kind === "file" ? tab.location : null;
          const tabPath = fileLocation?.path ?? null;
          const tabDocument = fileLocation
            ? state.documents.find((document) => document.id === fileLocation.documentId || document.path === fileLocation.path) ?? null
            : null;
          const isDragging = draggingTabId === tab.id;
          const tabDropTarget = tabDocument
            ? {
                kind: "active-viewer" as const,
                documentId: tabDocument.id,
                documentPath: tabDocument.path,
                renderer: tabDocument.renderer,
                dockingRequest: tabDocument.dockingRequest ?? null,
              }
            : null;
          const showTabMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const canSaveAs = tabDocument && isMoleculeCollectionPath(tabDocument.path);
            const items = [
              ...(canSaveAs
                ? [
                    {
                      kind: "item" as const,
                      id: "save-as",
                      text: "Save As...",
                      action: () => {
                        void actions.saveMoleculeCollectionAs(tabDocument.id);
                      },
                    },
                    { kind: "separator" as const },
                  ]
                : []),
              ...(tabDocument
                ? [
                    {
                      kind: "item" as const,
                      id: "reveal-tab-document",
                      text: "Reveal in Finder",
                      action: () => {
                        void actions.revealDocument(tabDocument);
                      },
                    },
                    {
                      kind: "item" as const,
                      id: "copy-tab-document-path",
                      text: "Copy Path",
                      action: () => {
                        void actions.copyDocumentPath(tabDocument);
                      },
                    },
                    {
                      kind: "item" as const,
                      id: "show-tab-document-metadata",
                      text: "Show Metadata",
                      action: () => {
                        actions.showDocumentMetadata(tabDocument);
                      },
                    },
                    { kind: "separator" as const },
                  ]
                : []),
              {
                kind: "item" as const,
                id: "close-tab",
                text: "Close Tab",
                action: () => actions.closeTab(tab.id),
              },
              ...(state.tabs.length > 1
                ? [
                    {
                      kind: "item" as const,
                      id: "close-other-tabs",
                      text: "Close Other Tabs",
                      action: () => {
                        for (const candidate of state.tabs) {
                          if (candidate.id !== tab.id) actions.closeTab(candidate.id);
                        }
                      },
                    },
                  ]
                : []),
              { kind: "separator" as const },
              {
                kind: "item" as const,
                id: "close-all-tabs",
                text: "Close All Tabs",
                action: actions.clearAllDocuments,
              },
            ];
            void showNativeContextMenu(items, { x: event.clientX, y: event.clientY }, { forceWeb: true });
          };
          return (
            <div
              key={tab.id}
              ref={(node) => setTabShellRef(tab.id, node)}
              className="tab-shell"
              data-active={active || undefined}
              data-dragging={isDragging || undefined}
              onDragOver={(event) => {
                updateNativeTabDrag(event);
                scheduleDragActivation(tab.id);
              }}
              onDrop={(event) => {
                if (!draggingTabIdRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                stopTabDrag();
              }}
            >
              <button
                type="button"
                role="tab"
                draggable
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                className={active ? "tab active" : "tab"}
                aria-grabbed={isDragging || undefined}
                onMouseDown={(event) => {
                  if (event.button === 2) {
                    showTabMenu(event);
                    return;
                  }
                  startMouseTabReorder(tab.id, event);
                }}
                onClick={() => actions.selectTab(tab.id)}
                onContextMenu={showTabMenu}
                onDragStart={(event) => {
                  draggingTabIdRef.current = tab.id;
                  setDraggingTabId(tab.id);
                  event.dataTransfer.effectAllowed = tabPath ? "copyMove" : "move";
                  event.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
                  if (tabPath) writeStructureDrag(event.dataTransfer, [tabPath]);
                  actions.setStructureDragActive(true);
                }}
                onDragEnd={stopTabDrag}
                onDragOver={(event) => {
                  if (!hasStructureDrag(event.dataTransfer)) return;
                  const payload = readStructureDragPayload(event.dataTransfer);
                  if (!tabDropTarget || shellDropActionChoices(payload, tabDropTarget, { kind: "tab" }).length === 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  if (!tabDocument || !hasStructureDrag(event.dataTransfer)) return;
                  const payload = readStructureDragPayload(event.dataTransfer);
                  if (payload.paths.length === 0 && payload.records.length === 0) return;
                  if (!tabDropTarget) return;
                  const choices = shellDropActionChoices(payload, tabDropTarget, { kind: "tab" });
                  if (choices.length === 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  actions.setStructureDragActive(false);
                  runShellDropActionChoices(actions, payload, choices, { x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    actions.selectTab(tab.id);
                    return;
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    const next = state.tabs[(index + 1) % state.tabs.length];
                    if (next) actions.selectTab(next.id);
                    return;
                  }
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = state.tabs[(index - 1 + state.tabs.length) % state.tabs.length];
                    if (next) actions.selectTab(next.id);
                    return;
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    const next = state.tabs[0];
                    if (next) actions.selectTab(next.id);
                    return;
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    const next = state.tabs[state.tabs.length - 1];
                    if (next) actions.selectTab(next.id);
                  }
                }}
                title={tabPath ?? title}
              >
                <span>{title}</span>
              </button>
              <button
                type="button"
                className="tab-close"
                aria-label={"Close " + title}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.closeTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </ScrollFade>
      <button type="button" className="new-tab" onClick={actions.openNewTab} title="New tab" aria-label="New tab">
        +
      </button>
      <div
        className="tab-strip-spacer"
        data-tauri-drag-region
        onDragOver={handleEmptyTabStripDragOver}
        onDrop={handleEmptyTabStripDrop}
      />
    </div>
  );
}
