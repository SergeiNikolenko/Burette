import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../components/ui/select';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, type PanelImperativeHandle } from '../components/ui/resizable';

import { useGroupPixelGuard } from '../components/ui/use-group-pixel-guard';

export function sequenceOptionLabel(label: string, role: string) {
  if (role !== 'View') return label;
  return ({ Chain: 'Chain', Polymers: 'All chains', Everything: 'All components' } as Record<string, string>)[label] ?? label;
}

// Use the desktop primitives inside the standalone preview, as preview-grid does.
export function mountSelect(native: HTMLSelectElement, role: string, label: string, changed: () => void) {
  const node = document.createElement('span');
  node.className = 'buret-seq-control';
  const root = createRoot(node);
  let close = () => {};
  function Menu() {
    const [open, setOpen] = useState(false);
    close = () => setOpen(false);
    return <Select open={open} onOpenChange={setOpen} defaultValue={String(native.selectedIndex)}
      disabled={native.disabled} onValueChange={value => {
        native.selectedIndex = Number(value);
        native.dispatchEvent(new Event('change', { bubbles: true }));
        changed();
      }}>
      <SelectTrigger className="buret-seq-button" size="sm" aria-label={`${role}: ${native.selectedOptions[0]?.text || 'None'}`}>
        <span>{label}</span>
      </SelectTrigger>
      <SelectContent className="buret-seq-menu" position="popper" align="start" sideOffset={6}
        style={{ width: role === 'Molecule' ? 340 : 200 }}>
        {Array.from(native.options, (option, index) => <SelectItem key={index} value={String(index)} textValue={option.text.replace(/^\d+:\s*/, '')} disabled={option.disabled}>
          {sequenceOptionLabel(option.text, role)}
        </SelectItem>)}
      </SelectContent>
    </Select>;
  }
  flushSync(() => root.render(<Menu />));
  return { node, close: () => close(), destroy: () => root.unmount() };
}

// The adapter measures Mol*'s intrinsic content after laying out its residue grid.
let contentHeight = 196;
let contentHeightChanged: ((height: number) => void) | undefined;
export function setContentHeight(height: number) {
  const next = Math.max(64, Math.ceil(height));
  if (next === contentHeight) return;
  contentHeight = next;
  contentHeightChanged?.(next);
}

type ResizeOptions = { initialHeight: number; onResize: () => void; onCollapse: () => void; onExpand: () => void; onCommit: (height: number) => void };

function SequenceResize({ initialHeight, onResize, onCollapse, onExpand, onCommit }: ResizeOptions) {
  const [maximumHeight, setMaximumHeight] = useState(contentHeight);
  const minimumHeight = Math.min(88, maximumHeight);
  useEffect(() => {
    contentHeightChanged = setMaximumHeight;
    setMaximumHeight(contentHeight);
    return () => { contentHeightChanged = undefined; };
  }, []);
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const openRef = useRef(false);
  const readyRef = useRef(false);
  const openingRef = useRef(false);
  const sizePxRef = useRef(initialHeight);
  const elementRef = useGroupPixelGuard([{ panelRef, openRef, sizePxRef }]);
  useEffect(() => {
    const syncVisibility = () => {
      const open = document.body.classList.contains('buret-sequence-open');
      if (openingRef.current && !open) return;
      if (open) openingRef.current = false;
      const reopening = open && !openRef.current;
      openRef.current = open;
      if (reopening) panelRef.current?.resize(`${sizePxRef.current}px`);
      else if (!open) panelRef.current?.collapse();
    };
    syncVisibility();
    readyRef.current = true;
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => { readyRef.current = false; observer.disconnect(); };
  }, []);
  return <ResizablePanelGroup orientation="vertical" className="buret-sequence-panels" elementRef={elementRef}
    onLayoutChange={layout => {
      // Closed panels stay at zero; opening from the separator is the only
      // resize not already coordinated by the toolbar visibility observer.
      if (readyRef.current && layout.sequence > 0 && !openRef.current) {
        openRef.current = true;
        openingRef.current = true;
        onExpand();
      }
    }}
    onLayoutChanged={(layout, meta) => {
      if (!meta.isUserInteraction) return;
      // The callback can precede the DOM update (notably for Home/End).
      const height = Math.round(layout.sequence / 100 * (elementRef.current?.clientHeight ?? 0));
      if (height < 1 && openRef.current) {
        openRef.current = false;
        onCollapse();
        return;
      }
      if (height < minimumHeight) return;
      sizePxRef.current = height;
      onCommit(height);
    }}>
    <ResizablePanel id="sequence" panelRef={panelRef} defaultSize="0px" minSize={`${minimumHeight}px`} maxSize={`${maximumHeight}px`} collapsible collapsedSize="0px"
      groupResizeBehavior="preserve-pixel-size" onResize={({ inPixels }) => {
        if (inPixels < 1) return;
        const value = `${Math.round(inPixels)}px`;
        if (document.documentElement.style.getPropertyValue('--buret-sequence-height') === value) return;
        document.documentElement.style.setProperty('--buret-sequence-height', value);
        onResize();
      }} />
    <ResizableHandle withHandle className="resizable-handle-horizontal" aria-label="Resize sequence" />
    <ResizablePanel id="structure" minSize="40%" />
  </ResizablePanelGroup>;
}

export function initResize(options: ResizeOptions) {
  // Static viewer-shell node, outside Mol*'s React tree; lives for this document.
  const host = document.getElementById('buret-sequence-resize');
  if (!host || host.dataset.bound === '1' || document.body.classList.contains('burette-mobile-host')) return;
  host.dataset.bound = '1';
  host.classList.replace('buret-sequence-resize', 'buret-sequence-layout');
  host.removeAttribute('role');
  host.removeAttribute('aria-orientation');
  host.removeAttribute('aria-label');
  createRoot(host).render(<SequenceResize {...options} />);
}
