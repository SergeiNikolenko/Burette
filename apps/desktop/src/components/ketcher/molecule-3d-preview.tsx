import { Component, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "./molecule-3d-preview.css";
import { MiewViewer, type NativeViewer } from "./miew-viewer";
import { Spinner } from "@/components/ui/spinner";

export type Molecule3dOptions = {
  settings?: Record<string, unknown>;
  reps?: Array<{ mode?: string | [string, Record<string, unknown>]; [key: string]: unknown }>;
  [key: string]: unknown;
};

type ElementPalette = { id: string; elementColors: Record<string, number> };
type PaletteRegistry = { get: (id: string) => ElementPalette | undefined; register: (palette: ElementPalette) => void };

// Lighten the native elemental hue only as far as needed for readable dark labels.
// The separate palette also colors bonds; no molecular coordinates are involved.
export function darkElementColor(color: number): number {
  const channels = [color >> 16 & 255, color >> 8 & 255, color & 255];
  for (let mix = 0; mix <= 10; mix++) {
    const rgb = channels.map(channel => Math.round(channel + (255 - channel) * mix / 10));
    const linear = rgb.map(channel => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    if ((luminance + 0.05) / (0.00857 + 0.05) >= 4.5) return rgb[0] << 16 | rgb[1] << 8 | rgb[2];
  }
  return 0xffffff;
}

export function registerDarkElementPalette(registry: PaletteRegistry, options: Molecule3dOptions) {
  const baseId = typeof options.settings?.palette === "string" ? options.settings.palette : "JM";
  const id = `${baseId}-burette-dark`;
  if (registry.get(id)) return;
  const source = registry.get(baseId);
  if (!source) return;
  const palette = Object.assign(Object.create(source), { id, elementColors: { ...source.elementColors } });
  for (const element of Object.keys(palette.elementColors)) palette.elementColors[element] = darkElementColor(palette.elementColors[element]);
  palette.elementColors.C = 0xd0d0d0;
  registry.register(palette);
}

type EditMode = "view" | "components" | "fragments";
// These are the same component/fragment operations used by Miew 0.11.1's C/F/A/D
// shortcuts. Apply commits to the viewer's CML copy, not the Ketcher structure.
type ViewerEngine = NativeViewer & {
  setOptions: (options: Molecule3dOptions) => void;
  set: (settings: Record<string, unknown>) => void;
  resetView: () => void;
  _editMode: number;
  _enterComponentEditMode: () => void;
  _enterFragmentEditMode: () => void;
  _applyComponentEdit: () => void;
  _applyFragmentEdit: () => void;
  _discardComponentEdit: () => void;
  _discardFragmentEdit: () => void;
  addEventListener: (name: string, handler: () => void) => void;
  removeEventListener: (name: string, handler: () => void) => void;
};
const viewerMode = (viewer: ViewerEngine): EditMode => viewer._editMode === 1 ? "components" : viewer._editMode === 2 ? "fragments" : "view";
function applyPreviewEdits(viewer: ViewerEngine | null) {
  if (viewer?._editMode === 1) viewer._applyComponentEdit();
  if (viewer?._editMode === 2) viewer._applyFragmentEdit();
}

type Props = {
  Viewer: ComponentType<{ onInit: (viewer: ViewerEngine) => void }>;
  onInit: (viewer: ViewerEngine) => Promise<void>;
  onApply: () => void;
  disabled: boolean;
  initialized: boolean;
  options: Molecule3dOptions;
  params: { onCancel?: (result: null) => void };
};

// Keep the supplied representations, elemental colors and native editing modes.
export function molecule3dOptions(options: Molecule3dOptions): Molecule3dOptions {
  const shellTheme = document.querySelector(".app-shell")?.getAttribute("data-effective-theme");
  const dark = shellTheme ? shellTheme === "dark"
    : document.documentElement.dataset.theme === "dark" || document.documentElement.classList.contains("dark");
  const color = dark ? 0x171717 : 0xffffff;
  return {
    ...options,
    settings: { ...options.settings, bg: { color },
      palette: dark ? `${typeof options.settings?.palette === "string" ? options.settings.palette : "JM"}-burette-dark` : (options.settings?.palette ?? "JM"),
      // Native fog also fades CSS atom labels into the background.
      // Keep small-molecule labels and bonds legible at every camera angle.
      editing: true, axes: false, fps: false, fog: false },
    reps: options.reps?.map(rep => Array.isArray(rep.mode) && rep.mode[0] === "TX"
      ? { ...rep, mode: ["TX", { ...rep.mode[1], bg: color, showBg: false }] }
      : rep),
  };
}

class PreviewBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function Molecule3dPreview({ onInit, onApply, disabled, initialized, options, params }: Props) {
  const engine = useRef<ViewerEngine | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [error, setError] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [confirmRotation, setConfirmRotation] = useState(false);
  const [mode, setMode] = useState<EditMode>("view");
  const [componentsChanged, setComponentsChanged] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState(false);
  const cancel = () => params.onCancel?.(null);
  const initializationError = useCallback((reason: unknown) => {
    console.error("3D structure initialization failed", reason);
    setError(true);
  }, []);
  const initialize = useCallback(async (viewer: ViewerEngine) => {
    engine.current = viewer;
    const registry = (viewer.constructor as unknown as { palettes?: PaletteRegistry }).palettes;
    if (registry) registerDarkElementPalette(registry, options);
    try {
      await onInit(viewer);
      // The original loader can restore its background after the canvas mounts.
      // set(), unlike setOptions(), retains the camera and chemical edit state.
      viewer.set(molecule3dOptions(options).settings ?? {});
    } catch (reason) {
      initializationError(reason);
    }
  }, [onInit, options, initializationError]);

  useEffect(() => {
    const updateTheme = () => engine.current?.set(molecule3dOptions(options).settings ?? {});
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const shell = document.querySelector(".app-shell");
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["data-effective-theme"] });
    return () => observer.disconnect();
  }, [options]);

  useEffect(() => {
    const viewer = engine.current;
    if (!initialized || !viewer) return;
    const update = () => setMode(viewerMode(viewer));
    viewer.addEventListener("editModeChanged", update);
    return () => viewer.removeEventListener("editModeChanged", update);
  }, [initialized]);

  const changeMode = (next: string | null) => {
    const viewer = engine.current;
    if (!viewer || next === null) return;
    applyPreviewEdits(viewer);
    if (next === "components") viewer._enterComponentEditMode();
    if (next === "fragments") viewer._enterFragmentEditMode();
    const active = viewerMode(viewer);
    setMode(active);
    setSelectionMessage(next === "fragments" && active !== "fragments");
    setConfirmRotation(false);
  };

  const apply = () => {
    if ((rotated || componentsChanged) && !confirmRotation) { setConfirmRotation(true); return; }
    applyPreviewEdits(engine.current);
    onApply();
  };

  return <Dialog open onOpenChange={open => { if (!open) cancel(); }}>
    <DialogContent className="ketcher-ui-dialog molecule-3d-dialog" aria-describedby={undefined}
      style={{ width: "min(760px, calc(100vw - 24px))" }} container={document.fullscreenElement as HTMLElement | null ?? undefined}
      data-testid="molecule-3d-dialog">
      <DialogHeader><DialogTitle>3D structure</DialogTitle></DialogHeader>
      <Select value={mode} onValueChange={changeMode} disabled={!initialized || disabled || error}>
        <SelectTrigger className="w-44" aria-label="Rotation mode" data-testid="molecule-3d-mode"><SelectValue /></SelectTrigger>
        <SelectContent container={document.fullscreenElement as HTMLElement | null ?? undefined}>
          <SelectItem value="view">Rotate view</SelectItem>
          <SelectItem value="components">Rotate components</SelectItem>
          <SelectItem value="fragments">Rotate fragment</SelectItem>
        </SelectContent>
      </Select>
      {selectionMessage && <p role="status" className="text-sm">Select a fragment around a single bond first.</p>}
      <div style={{ height: "min(58dvh, 440px)" }}
        className="molecule-3d-canvas relative min-h-0 overflow-hidden rounded-lg bg-background" data-testid="molecule-3d-canvas" onPointerDownCapture={event => {
          if (event.button === 0) start.current = { x: event.clientX, y: event.clientY };
        }} onPointerMoveCapture={event => {
          const origin = start.current;
          if (origin && event.buttons === 1 && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) {
            setRotated(true); setConfirmRotation(false);
            if (engine.current && viewerMode(engine.current) !== "view") setComponentsChanged(true);
          }
        }} onPointerUpCapture={() => { start.current = null; }} onPointerCancelCapture={() => { start.current = null; }}>
        <PreviewBoundary onError={() => setError(true)}><Suspense fallback={null}><MiewViewer onInit={initialize} onError={initializationError} /></Suspense></PreviewBoundary>
        {!initialized && !error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label="Loading structure">
          <Spinner className="motion-reduce:animate-none" aria-hidden="true" />
        </div>}
        {error && <div className="absolute inset-0 flex items-center justify-center bg-background" role="alert">Could not open the 3D structure.</div>}
      </div>
      {confirmRotation && <p role="alert" className="text-sm">Applying this view may change stereochemistry. Check the stereocenters after applying.</p>}
      <DialogFooter>
        <Button variant="ghost" size="sm" disabled={!initialized || error} className="mr-auto" onClick={() => {
          const viewer = engine.current;
          if (viewer?._editMode === 1) viewer._discardComponentEdit();
          if (viewer?._editMode === 2) viewer._discardFragmentEdit();
          viewer?.resetView(); viewer?.setOptions(molecule3dOptions(options));
          setMode("view"); setRotated(false); setConfirmRotation(false); setSelectionMessage(false);
        }}>Reset view</Button>
        <Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={disabled || error} data-testid="miew-modal-button">
          {confirmRotation ? "Apply rotation" : "Apply"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
