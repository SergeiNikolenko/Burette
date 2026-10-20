import type { Ketcher, RenderOptions } from "ketcher-core";
type KetcherCoreModule = typeof import("ketcher-core");
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Use Ketcher's rendering options so picking, labels and stereo bonds keep their
// actual geometry. These styles also survive a change in the Settings dialog.
// Ketcher's own selection colors serve as markers that workspace.css maps onto
// the theme: a soft opaque plate without an outline, as in Burette.
const SELECTION_MARK = "#57ff8f";
const HOVER_MARK = "#ccffdd";
const OUTLINE_MARK = "#0097a8";
function renderingInteractionStyles(editor: Ketcher["editor"], lineWidth = editor.render.options.bondThicknessInPx) {
  return {
    lineWidth,
    atomSelectionPlateRadius: editor.render.options.fontszInPx * 0.6,
    radiusScaleFactor: 0.18,
    selectionStyle: { fill: SELECTION_MARK, stroke: "none" },
    hoverStyle: { fill: HOVER_MARK, stroke: "none" },
    innerHoverStyle: { fill: "none", stroke: OUTLINE_MARK, "stroke-width": 1 },
    selectionStyleSimpleObject: { fill: "none", stroke: SELECTION_MARK, "stroke-width": lineWidth * 4, "stroke-linecap": "round", "stroke-linejoin": "round" },
    hoverStyleSimpleObject: { fill: "none", stroke: HOVER_MARK, "stroke-width": lineWidth * 4, "stroke-linecap": "round", "stroke-linejoin": "round" },
    bondSnappingStyle: { fill: HOVER_MARK, stroke: OUTLINE_MARK, "stroke-width": lineWidth },
    arrowSnappingStyle: { fill: HOVER_MARK, stroke: OUTLINE_MARK },
  };
}

// The previous gray capsules; only used to recognize settings saved by that adapter.
function legacyInteractionStyles(editor: Ketcher["editor"], lineWidth: number, dark: boolean) {
  const stroke = dark ? "#a3a3a3" : "#737373";
  const fill = dark ? "#404040" : "#e5e5e5";
  return {
    lineWidth,
    atomSelectionPlateRadius: editor.render.options.fontszInPx * 0.6,
    radiusScaleFactor: 0.18,
    selectionStyle: { fill, stroke, "stroke-width": 1 },
    hoverStyle: { fill, stroke, "stroke-width": 1 },
    innerHoverStyle: { fill: "none", stroke, "stroke-width": 1 },
    selectionStyleSimpleObject: { fill: "none", stroke, "stroke-width": lineWidth * 2, "stroke-linecap": "round" },
    hoverStyleSimpleObject: { fill: "none", stroke, "stroke-width": 1 },
    bondSnappingStyle: { fill, stroke, "stroke-width": lineWidth },
    arrowSnappingStyle: { fill, stroke },
  };
}

export function applyRenderingDefaults(instance: Ketcher, convertOptions: KetcherCoreModule["getOptionsWithConvertedUnits"]) {
  const editor = instance.editor;
  let saved: Record<string, unknown> = {};
  let defaultsMigrated = false;
  const defaultsKey = "burette-ketcher-rendering-defaults";
  try {
    const value: unknown = JSON.parse(localStorage.getItem("ketcher-opts") || "{}");
    if (isRecord(value)) saved = value;
    defaultsMigrated = localStorage.getItem(defaultsKey) === "2";
  } catch { /* Use the editor defaults for an unreadable preference. */ }
  // The previous adapter persisted its 1px default through setOptions. Match
  // that complete presentation signature once, leaving ordinary user settings
  // and all later explicit size choices intact.
  const legacyThinDefault = !defaultsMigrated && saved.bondThickness === 1 && saved.bondThicknessUnit === "px"
    && saved.bondThicknessInPx === 1 && isRecord(saved.lineattr) && saved.lineattr["stroke-width"] === 1
    && [false, true].some(dark => Object.entries(legacyInteractionStyles(editor, 1, dark))
      .every(([key, value]) => JSON.stringify(saved[key]) === JSON.stringify(value)));
  // Restore Ketcher's 2px default while keeping explicit user sizes. Wedges,
  // hashed bonds, atomic colors and all stereo labels remain Ketcher's own.
  const bondOptions = saved.bondThickness === undefined || legacyThinDefault ? { bondThickness: 2, bondThicknessUnit: "px" as RenderOptions["bondThicknessUnit"] } : {};
  const options = convertOptions({ ...editor.render.options, ...saved, ...bondOptions });
  const thickness = options.bondThicknessInPx;
  editor.setOptions(JSON.stringify({
    ...saved,
    ...bondOptions,
    bondThicknessInPx: thickness,
    ...renderingInteractionStyles(editor, thickness),
    lineattr: { ...editor.render.options.lineattr, "stroke-width": thickness },
  }));
  try { localStorage.setItem(defaultsKey, "2"); } catch { /* Rendering still works without persisted preferences. */ }
}

// Settings replace the renderer asynchronously. Publish the API only after the
// committed canvas exists, so initial stereo labels are measured while attached.
export function settleRenderingDefaults(instance: Ketcher, apply: () => void, signal: AbortSignal) {
  const service = (instance as { settingsService?: { subscribe?: (listener: () => void) => () => void } }).settingsService;
  return new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let frame = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsubscribe?.();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const afterCommit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
    };
    const timer = setTimeout(finish, 1500);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) { finish(); return; }
    try {
      unsubscribe = service?.subscribe?.(afterCommit);
      apply();
      if (!unsubscribe) afterCommit();
    } catch (error) {
      unsubscribe?.();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
      done = true;
      reject(error);
    }
  });
}
