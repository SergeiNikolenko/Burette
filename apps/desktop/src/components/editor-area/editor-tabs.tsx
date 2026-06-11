import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { ScrollFade } from "../scroll-fade";
import { hasStructureDrag, readStructureDragPayload, type StructureDragPayload, writeStructureDragPayload } from "../../lib/structure-drag";
import { runShellDropActionChoices, shellDropActionChoices } from "../drop-action-executor";
import { showNativeContextMenu } from "../native-context-menu";
import { pageKind } from "./page-kinds";
import { isMoleculeCollectionPath } from "../../lib/collection-documents";
import { CloseIcon } from "../close-icon";
import type { DropTargetContext } from "../../lib/drop-actions";

const TAB_DRAG_MIME = "application/x-burrete-tab-id";
const TAB_REORDER_ANIMATION_MS = 170;
const TAB_DRAG_ACTIVATE_DELAY_MS = 520;
const TAB_MOUSE_REORDER_THRESHOLD_PX = 8;

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const visibleTabs = state.tabs.filter((tab) => tab.location.kind !== "settings");
  const activeTabIndex = visibleTabs.findIndex((tab) => tab.id === state.activeTabId);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorTabId, setSelectionAnchorTabId] = useState<string | null>(null);
  const draggingTabIdRef = useRef<string | null>(null);
  const selectedTabIdsRef = useRef<Set<string>>(new Set());
  const mouseDragRef = useRef<{ tabId: string; startX: number; active: boolean } | null>(null);
  const removeMouseDragListenersRef = useRef<(() => void) | null>(null);
  const dragActivationRef = useRef<{ tabId: string; timeout: number } | null>(null);
  const tabShellRefs = useRef(new Map<string, HTMLDivElement>());
  const previousTabRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const latestTabsRef = useRef(visibleTabs);
  latestTabsRef.current = visibleTabs;

  const updateSelectedTabIds = useCallback((next: Set<string>, anchorId: string | null = selectionAnchorTabId) => {
    selectedTabIdsRef.current = next;
    setSelectedTabIds(next);
    setSelectionAnchorTabId(anchorId);
  }, [selectionAnchorTabId]);

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
    for (const tab of visibleTabs) {
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

  const tabPathForLocation = useCallback((tab: ShellViewState["tabs"][number]) => {
    if (tab.location.kind === "file") return tab.location.path;
    if (tab.location.kind === "text-file") return tab.location.path;
    return null;
  }, []);

  const tabPayloadItem = useCallback((tab: ShellViewState["tabs"][number], path: string) => {
    const kind = pageKind(tab.location);
    return {
      kind: tab.location.kind === "ketcher" ? "ketcher" as const : tab.location.kind === "text-file" ? "writer" as const : "tab" as const,
      title: kind.title(tab.location, state),
      detail: kind.description,
      path,
    };
  }, [state]);

  const tabStructurePayloadForIds = useCallback((tabIds: string[]): StructureDragPayload | null => {
    const wanted = new Set(tabIds);
    const paths: string[] = [];
    const items: StructureDragPayload["items"] = [];
    for (const tab of latestTabsRef.current) {
      if (!wanted.has(tab.id)) continue;
      const path = tabPathForLocation(tab);
      if (!path) continue;
      paths.push(path);
      items.push(tabPayloadItem(tab, path));
    }
    return paths.length > 0 ? { paths, records: [], items } : null;
  }, [tabPathForLocation, tabPayloadItem]);

  const tabStructurePayload = useCallback((tabId: string): StructureDragPayload | null => {
    const selected = selectedTabIdsRef.current;
    const sourceIds = selected.has(tabId) && selected.size > 1
      ? latestTabsRef.current.filter((tab) => selected.has(tab.id)).map((tab) => tab.id)
      : [tabId];
    return tabStructurePayloadForIds(sourceIds);
  }, [tabStructurePayloadForIds]);

  const selectableTabIds = useCallback(() => (
    latestTabsRef.current
      .filter((tab) => Boolean(tabPathForLocation(tab)))
      .map((tab) => tab.id)
  ), [tabPathForLocation]);

  const selectAllTabs = useCallback(() => {
    const ids = selectableTabIds();
    updateSelectedTabIds(new Set(ids), ids[ids.length - 1] ?? null);
  }, [selectableTabIds, updateSelectedTabIds]);

  const clearSelectedTabs = useCallback(() => {
    updateSelectedTabIds(new Set(), null);
  }, [updateSelectedTabIds]);

  const toggleSelectedTab = useCallback((tabId: string) => {
    const tab = latestTabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab || !tabPathForLocation(tab)) return;
    const next = new Set(selectedTabIdsRef.current);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    updateSelectedTabIds(next, tabId);
  }, [tabPathForLocation, updateSelectedTabIds]);

  const selectTabRange = useCallback((tabId: string) => {
    const ids = selectableTabIds();
    const targetIndex = ids.indexOf(tabId);
    const anchorIndex = ids.indexOf(selectionAnchorTabId ?? "");
    if (targetIndex < 0 || anchorIndex < 0) {
      updateSelectedTabIds(new Set([tabId]), tabId);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    updateSelectedTabIds(new Set(ids.slice(start, end + 1)), selectionAnchorTabId);
  }, [selectableTabIds, selectionAnchorTabId, updateSelectedTabIds]);

  const handleTabClick = useCallback((tabId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelectedTab(tabId);
      actions.selectTab(tabId);
      return;
    }
    if (event.shiftKey) {
      selectTabRange(tabId);
      actions.selectTab(tabId);
      return;
    }
    clearSelectedTabs();
    actions.selectTab(tabId);
  }, [actions, clearSelectedTabs, selectTabRange, toggleSelectedTab]);

  const handleTabListKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllTabs();
      return;
    }
    if (event.key === "Escape" && selectedTabIdsRef.current.size > 0) {
      event.preventDefault();
      clearSelectedTabs();
    }
  }, [clearSelectedTabs, selectAllTabs]);

  useEffect(() => {
    const currentIds = new Set(visibleTabs.map((tab) => tab.id));
    const next = new Set([...selectedTabIdsRef.current].filter((id) => currentIds.has(id)));
    if (next.size !== selectedTabIdsRef.current.size) {
      updateSelectedTabIds(next, next.has(selectionAnchorTabId ?? "") ? selectionAnchorTabId : null);
    }
  }, [selectionAnchorTabId, updateSelectedTabIds, visibleTabs]);

  const dropTargetForTabId = useCallback((tabId: string): DropTargetContext | null => {
    const tab = latestTabsRef.current.find((candidate) => candidate.id === tabId);
    const fileLocation = tab?.location.kind === "file" ? tab.location : null;
    if (!fileLocation) return null;
    const document = state.documents.find((candidate) => (
      candidate.id === fileLocation.documentId || candidate.path === fileLocation.path
    ));
    return {
      kind: "active-viewer",
      documentId: document?.id ?? fileLocation.documentId,
      documentPath: document?.path ?? fileLocation.path,
      renderer: document?.renderer ?? null,
      dockingRequest: document?.dockingRequest ?? null,
    };
  }, [state.documents]);

  const tabIdFromPoint = useCallback((clientX: number, clientY: number, excludedTabId: string | null = null) => {
    for (const tab of latestTabsRef.current) {
      if (tab.id === excludedTabId) continue;
      const element = tabShellRefs.current.get(tab.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return tab.id;
    }
    return null;
  }, []);

  const activeViewerDropTargetAtPoint = useCallback((sourceTabId: string, clientX: number, clientY: number): DropTargetContext | null => {
    const element = typeof document === "undefined" ? null : document.elementFromPoint(clientX, clientY);
    if (!element?.closest(".molecule-stage, .main-stage")) return null;
    if (state.activeTabId === sourceTabId) return null;
    const activeDocument = state.activeDocument;
    if (!activeDocument) return null;
    return {
      kind: "active-viewer",
      documentId: activeDocument.id,
      documentPath: activeDocument.path,
      renderer: activeDocument.renderer,
      dockingRequest: activeDocument.dockingRequest ?? null,
    };
  }, [state.activeDocument, state.activeTabId]);

  const runTabDropAtPoint = useCallback((sourceTabId: string, clientX: number, clientY: number) => {
    if (clientX <= 0 && clientY <= 0) return false;
    const payload = tabStructurePayload(sourceTabId);
    if (!payload || (payload.paths.length === 0 && payload.records.length === 0)) return false;
    const targetTabId = tabIdFromPoint(clientX, clientY, sourceTabId);
    const target = targetTabId
      ? dropTargetForTabId(targetTabId)
      : activeViewerDropTargetAtPoint(sourceTabId, clientX, clientY);
    if (!target) return false;
    const choices = shellDropActionChoices(payload, target, { kind: "tab" });
    if (choices.length === 0) return false;
    actions.setStructureDragActive(false);
    return runShellDropActionChoices(actions, payload, choices, { x: clientX, y: clientY });
  }, [actions, activeViewerDropTargetAtPoint, dropTargetForTabId, tabIdFromPoint, tabStructurePayload]);

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
    const stateTabsWithoutDragged = state.tabs.filter((tab) => tab.id !== tabId);
    const targetTabId = otherTabs[targetIndex]?.id ?? null;
    const stateTargetIndex = targetTabId
      ? stateTabsWithoutDragged.findIndex((tab) => tab.id === targetTabId)
      : stateTabsWithoutDragged.length;
    previousTabRectsRef.current = measureTabRects();
    actions.moveTab(tabId, stateTargetIndex);
  }, [actions, measureTabRects, state.tabs]);

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

  const selectAndFocusTab = useCallback((tabId: string) => {
    actions.selectTab(tabId);
    tabShellRefs.current.get(tabId)?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
  }, [actions]);

  const stopTabDrag = useCallback(() => {
    removeMouseDragListeners();
    clearDragActivation();
    if (draggingTabIdRef.current) actions.setStructureDragActive(false);
    draggingTabIdRef.current = null;
    setDraggingTabId(null);
  }, [actions, clearDragActivation, removeMouseDragListeners]);

  const startMouseTabReorder = useCallback((tabId: string, tabHasDockPayload: boolean, event: React.MouseEvent<HTMLButtonElement>) => {
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
        if (tabHasDockPayload) actions.setStructureDragActive(true);
      }
      moveDraggedTab(tabId, moveEvent.clientX);
    };
    const handleMouseUp = (upEvent: MouseEvent) => {
      const drag = mouseDragRef.current;
      if (drag?.tabId === tabId && drag.active && tabHasDockPayload) {
        runTabDropAtPoint(tabId, upEvent.clientX, upEvent.clientY);
      }
      stopTabDrag();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
    removeMouseDragListenersRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [actions, moveDraggedTab, removeMouseDragListeners, runTabDropAtPoint, stopTabDrag]);

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
    <div className="tab-strip">
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
        onDragOver={handleEmptyTabStripDragOver}
        onDrop={handleEmptyTabStripDrop}
        onKeyDown={handleTabListKeyDown}
      >
        {visibleTabs.map((tab, index) => {
          const kind = pageKind(tab.location);
          const title = kind.title(tab.location, state);
          const active = index === activeTabIndex;
          const fileLocation = tab.location.kind === "file" ? tab.location : null;
          const textFileLocation = tab.location.kind === "text-file" ? tab.location : null;
          const tabPath = tabPathForLocation(tab);
          const tabDragItem = {
            kind: tab.location.kind === "ketcher" ? "ketcher" as const : tab.location.kind === "text-file" ? "writer" as const : "tab" as const,
            title,
            detail: kind.description,
            path: tabPath ?? undefined,
          };
          const tabDocument = fileLocation
            ? state.documents.find((document) => document.id === fileLocation.documentId || document.path === fileLocation.path) ?? null
            : null;
          const textDocument = textFileLocation
            ? state.textDocuments.find((document) => document.id === textFileLocation.documentId || document.path === textFileLocation.path) ?? null
            : null;
          const isDragging = draggingTabId === tab.id;
          const selected = selectedTabIds.has(tab.id);
          const tabDropTarget = fileLocation
            ? {
                kind: "active-viewer" as const,
                documentId: tabDocument?.id ?? fileLocation.documentId,
                documentPath: tabDocument?.path ?? fileLocation.path,
                renderer: tabDocument?.renderer ?? null,
                dockingRequest: tabDocument?.dockingRequest ?? null,
              }
            : null;
          const showTabMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const canSaveAs = tabDocument && isMoleculeCollectionPath(tabDocument.path);
            const canSelectAll = selectableTabIds().length > 1;
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
              ...(textDocument
                ? [
                    {
                      kind: "item" as const,
                      id: "reveal-tab-text-file",
                      text: "Reveal in Finder",
                      action: () => {
                        void actions.revealPath(textDocument.path, "file");
                      },
                    },
                    {
                      kind: "item" as const,
                      id: "copy-tab-text-file-path",
                      text: "Copy Path",
                      action: () => {
                        void actions.copyPath(textDocument.path, "file");
                      },
                    },
                    {
                      kind: "item" as const,
                      id: "show-tab-text-file-metadata",
                      text: "Show Metadata",
                      action: () => {
                        actions.showTextFileMetadata(textDocument);
                      },
                    },
                    { kind: "separator" as const },
                  ]
                : []),
              ...(canSelectAll
                ? [
                    {
                      kind: "item" as const,
                      id: "select-all-tabs",
                      text: "Select All Tabs",
                      action: selectAllTabs,
                    },
                    ...(selectedTabIds.size > 0
                      ? [
                          {
                            kind: "item" as const,
                            id: "clear-tab-selection",
                            text: "Clear Tab Selection",
                            action: clearSelectedTabs,
                          },
                        ]
                      : []),
                    { kind: "separator" as const },
                  ]
                : []),
              {
                kind: "item" as const,
                id: "close-tab",
                text: "Close Tab",
                action: () => actions.closeTab(tab.id),
              },
              ...(visibleTabs.length > 1
                ? [
                    {
                      kind: "item" as const,
                      id: "close-other-tabs",
                      text: "Close Other Tabs",
                      action: () => {
                        for (const candidate of visibleTabs) {
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
              data-selected={selected || undefined}
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
                  startMouseTabReorder(tab.id, true, event);
                }}
                onClick={(event) => handleTabClick(tab.id, event)}
                onContextMenu={showTabMenu}
                onDragStart={(event) => {
                  draggingTabIdRef.current = tab.id;
                  setDraggingTabId(tab.id);
                  event.dataTransfer.effectAllowed = "copyMove";
                  event.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
                  const payload = tabStructurePayload(tab.id) ?? {
                    paths: tabPath ? [tabPath] : [],
                    records: [],
                    items: [tabDragItem],
                  };
                  writeStructureDragPayload(event.dataTransfer, payload);
                  actions.setStructureDragActive(true);
                }}
                onDragEnd={(event) => {
                  runTabDropAtPoint(tab.id, event.clientX, event.clientY);
                  stopTabDrag();
                }}
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
                    const next = visibleTabs[(index + 1) % visibleTabs.length];
                    if (next) selectAndFocusTab(next.id);
                    return;
                  }
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = visibleTabs[(index - 1 + visibleTabs.length) % visibleTabs.length];
                    if (next) selectAndFocusTab(next.id);
                    return;
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    const next = visibleTabs[0];
                    if (next) selectAndFocusTab(next.id);
                    return;
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    const next = visibleTabs[visibleTabs.length - 1];
                    if (next) selectAndFocusTab(next.id);
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
                <CloseIcon size={13} />
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
