import { useLayoutEffect, useRef, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import * as RovingFocusGroup from "@radix-ui/react-roving-focus";
import { DOCK_TAB_LABELS, type DockArea, type DockTab, type DockTabKind } from "../lib/dock";
import { Atom, Chart, Compare, Eye, FileCode, FileDocument, Folder, InfoCircle, Orbit, Plus, SettingsWrench, Stack, Stopwatch, X, type AppIconType } from "./ui/app-icons";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const icons: Record<DockTabKind, AppIconType> = {
  scene: Stack, xyzrender: Atom, files: Folder, spectrum: Chart, text: FileDocument,
  story: FileDocument, inspector: InfoCircle, folding: Atom, "structure-basket": Stack,
  compare: Compare, jobs: Stopwatch, logs: FileCode, diagnostics: SettingsWrench,
  review: Eye, "chemical-space": Orbit,
};

export function DockHeader({ area, tabs, activeKind, panelId, readOnly, transientTabId, fileDragProps, onSelect, onClose, onAdd, onHide, screens = [], onSelectScreen, onCloseScreen, onScreenMenu }: {
  area: DockArea;
  tabs: DockTab[];
  activeKind: DockTabKind | null;
  screens?: { id: string; title: string; icon: ReactNode; active: boolean }[];
  onSelectScreen?: (id: string) => void;
  onCloseScreen?: (id: string) => void;
  onScreenMenu?: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  panelId: string;
  readOnly: boolean;
  transientTabId?: string;
  fileDragProps: Pick<ComponentProps<"button">, "draggable" | "onMouseDown" | "onClickCapture" | "onDragStart" | "onDragEnd">;
  onSelect: (kind: DockTabKind) => void;
  onClose: (id: string) => void;
  onAdd: (event: MouseEvent<HTMLButtonElement>) => void;
  onHide: () => void;
}) {
  const header = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    header.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [tabs, screens, activeKind]);

  const close = (id: string) => {
    if (tabs.length + screens.length === 1) { onHide(); return; }
    restoreFocus.current = true;
    onClose(id);
  };

  // The right dock's header shares the window title row (Codex side panel), so
  // its empty space drags the window and the title-row toggle hides it.
  return <TooltipProvider><div className="dock-header" ref={header} data-tauri-drag-region={area === "right" || undefined}>
    <RovingFocusGroup.Root asChild orientation="horizontal" loop>
      <div className="dock-tab-strip" role="tablist" aria-label={area === "right" ? "Side panel tabs" : "bottom dock tabs"}>
        {screens.map(screen => <div className="dock-tab-shell" data-active={screen.active || undefined} key={screen.id}>
          <RovingFocusGroup.Item asChild active={screen.active}>
            <Button type="button" variant="ghost" size="sm" className="dock-tab" role="tab"
              aria-selected={screen.active} aria-label={screen.title} aria-keyshortcuts="Delete"
              data-active={screen.active || undefined} data-closable
              onClick={() => onSelectScreen?.(screen.id)}
              onContextMenu={event => onScreenMenu?.(screen.id, event)}
              onKeyDown={event => {
                if (event.key === "Delete") { event.preventDefault(); restoreFocus.current = true; onCloseScreen?.(screen.id); }
              }}>
              {screen.icon}<span>{screen.title}</span>
            </Button>
          </RovingFocusGroup.Item>
          <Tooltip><TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-2xs" className="dock-tab-close"
              aria-label={`Close ${screen.title}`} onClick={() => { restoreFocus.current = true; onCloseScreen?.(screen.id); }}><X aria-hidden /></Button>
          </TooltipTrigger><TooltipContent compact showArrow={false}>Close {screen.title}</TooltipContent></Tooltip>
        </div>)}
        {tabs.map(tab => {
          const Icon = icons[tab.kind];
          const active = tab.kind === activeKind;
          const closable = !readOnly && tab.id !== transientTabId;
          return <div className="dock-tab-shell" data-active={active || undefined} key={tab.id}>
            <RovingFocusGroup.Item asChild active={active}>
              <Button type="button" variant="ghost" size="sm" className="dock-tab" role="tab"
                id={`${panelId}-${tab.kind}`} aria-controls={panelId} aria-selected={active}
                aria-label={DOCK_TAB_LABELS[tab.kind]} aria-keyshortcuts={closable ? "Delete" : undefined}
                data-active={active || undefined} data-closable={closable || undefined}
                {...(tab.kind === "files" ? fileDragProps : {})}
                onClick={() => onSelect(tab.kind)}
                onKeyDown={event => {
                  if (event.key === "Delete" && closable) { event.preventDefault(); close(tab.id); }
                }}>
                <Icon className="size-4" aria-hidden /><span>{DOCK_TAB_LABELS[tab.kind]}</span>
              </Button>
            </RovingFocusGroup.Item>
            {closable && <Tooltip><TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-2xs" className="dock-tab-close"
                aria-label={`Close ${DOCK_TAB_LABELS[tab.kind]}`} onClick={() => close(tab.id)}><X aria-hidden /></Button>
            </TooltipTrigger><TooltipContent compact showArrow={false}>Close {DOCK_TAB_LABELS[tab.kind]}</TooltipContent></Tooltip>}
          </div>;
        })}
      </div>
    </RovingFocusGroup.Root>
    {!readOnly && <>
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-toolbar" className="dock-icon-button" onClick={onAdd} aria-label={`Add ${area} dock tab`}><Plus aria-hidden /></Button></TooltipTrigger><TooltipContent compact showArrow={false}>Add panel</TooltipContent></Tooltip>
      {area === "bottom" && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-toolbar" className="dock-icon-button dock-hide-button" onClick={onHide} aria-label={`Close ${area} dock`}><X aria-hidden /></Button></TooltipTrigger><TooltipContent compact showArrow={false}>Close panel</TooltipContent></Tooltip>}
    </>}
  </div></TooltipProvider>;
}
