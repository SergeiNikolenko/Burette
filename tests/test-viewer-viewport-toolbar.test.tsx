import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLSelectElement", "Element", "Node", "Event", "MouseEvent", "PointerEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { mountViewerViewportToolbar } = await import("../apps/desktop/src/preview-controls/viewer-viewport-toolbar");
const { mountViewerSelectionToolbar } = await import("../apps/desktop/src/preview-controls/viewer-selection-toolbar");
const viewer = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
const source = (name: string) => {
  const start = viewer.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`Missing viewer function: ${name}`);
  return viewer.slice(start, viewer.indexOf("\n  }", start) + 4);
};

test("shared viewport controls preserve camera, lighting, selection, animation, scene reload and tooltip ownership", async () => {
  document.body.innerHTML = '<div id="buret-viewport-rail" role="toolbar"></div><div id="buret-selection-bar" class="hidden"></div>';
  const rail = document.getElementById("buret-viewport-rail")!;
  const calls: unknown[] = [];
  const listeners = new Set<() => void>();
  const changed = { subscribe(callback: () => void) { listeners.add(callback); return { unsubscribe: () => listeners.delete(callback) }; } };
  let motion = "off", wiggle = "off", trajectory = false, theme = "dark";
  const canvas = {
    props: { illumination: { enabled: false } },
    setProps(props: { illumination: { enabled: boolean } }) { canvas.props = props; calls.push(["lighting", props.illumination.enabled]); },
    requestCameraReset: (options: unknown) => calls.push(["reset", options]),
  };
  const plugin = { selectionMode: false, canvas3d: canvas, managers: {
    animation: { state: { animationState: "stopped" } },
    structure: { selection: { stats: { elementCount: 0, label: "" }, events: { changed } } },
  }, behaviors: { state: { isAnimating: changed } } };
  const bindings = {
    dismissFloatingMenu: (menu: Element | null) => menu?.remove(), revealFloatingMenu: () => {},
    document, window: { BuretteNativeViewerMenus: {
      mountViewportToolbar: mountViewerViewportToolbar, mountSelectionToolbar: mountViewerSelectionToolbar,
      styleControls: (element: HTMLElement) => { element.dataset.effectiveTheme = theme; },
    } },
    viewportPlugin: () => plugin, activeConfig: {}, resolveViewerTheme: () => theme,
    viewportMotionState: () => ({ name: motion }), viewportWiggleState: () => ({ name: wiggle }),
    activeTrajectoryPlaybackControl: { isPlaying: () => trajectory },
    initViewportRailDrag: () => {}, updateFloatingLayoutOffsets: () => {},
    molstarSelectionLevel: () => "residue", setMolstarSelectionLevel: () => {}, VIEWPORT_GRANULARITIES: [["residue", "Residue"]],
    runSelectionBarAction: () => {}, runViewportMenuAction: () => false,
    viewportCameraMenu: () => {}, viewportScreenshotMenu: () => {}, viewportAnimateMenu: () => {},
    openViewportMenu: (button: HTMLButtonElement, name: string) => { button.setAttribute("aria-expanded", "true"); calls.push(["menu", name]); },
    clearMolstarPersistentMoleculePreview: () => calls.push(["clear-preview"]),
    clearMolstarSelection: async () => { plugin.managers.structure.selection.stats.elementCount = 0; calls.push(["clear-selection"]); },
    hideMolstarContextMenu: () => {}, setStatus: () => {},
  };
  const methods = ["initViewportControls", "viewportRailState", "updateViewportAnimateState", "updateSelectionBar", "runViewportRailAction", "closeViewportMenu"].map(source).join("\n");
  const api = new Function(...Object.keys(bindings), `let viewportControlsDisposers = []; let viewportSelectionControls = null; let viewportMenuControls = null; let viewportRailControls = null;
    ${methods}; return { init: initViewportControls, update: updateSelectionBar, animate: updateViewportAnimateState, dispose: () => {
      viewportSelectionControls?.dispose(); viewportRailControls?.dispose(); viewportControlsDisposers.forEach(dispose => dispose());
    } };`)(...Object.values(bindings));
  const button = (action: string) => rail.querySelector<HTMLButtonElement>(`[data-buret-viewport-action="${action}"]`)!;
  const click = async (action: string) => { await act(async () => button(action).click()); };
  try {
    await act(async () => api.init({ plugin }));
    expect([...rail.querySelectorAll("button")].map(b => [b.getAttribute("aria-label"), b.classList.contains("atlas-button")])).toEqual([
      ["Camera", true], ["Save a screenshot", true], ["Realistic lighting", true], ["Animate the scene", true], ["Selection mode", true],
    ]);
    const camera = button("camera");
    await act(async () => api.init({ plugin }));
    expect([button("camera") === camera, listeners.size]).toEqual([true, 2]);
    await click("camera");
    await act(async () => listeners.forEach(listener => listener()));
    expect(camera.getAttribute("aria-expanded")).toBe("true");
    await click("screenshot");
    await click("animate");
    expect(calls).toEqual([["reset", { durationMs: 250 }], ["menu", "Camera"], ["menu", "Screenshot"], ["menu", "Animate"]]);
    expect(button("animate").getAttribute("aria-haspopup")).toBe("dialog");
    await click("illumination");
    expect([canvas.props.illumination.enabled, button("illumination").getAttribute("aria-pressed"), button("illumination").hasAttribute("data-selected")]).toEqual([true, "true", true]);
    await click("illumination");
    expect([canvas.props.illumination.enabled, button("illumination").getAttribute("aria-pressed"), button("illumination").hasAttribute("data-selected")]).toEqual([false, "false", false]);
    await click("select-mode");
    expect([plugin.selectionMode, button("select-mode").getAttribute("aria-pressed"), document.getElementById("buret-selection-bar")!.classList.contains("hidden")]).toEqual([true, "true", false]);
    plugin.managers.structure.selection.stats = { elementCount: 8, label: "2 Residues" };
    await act(async () => listeners.forEach(listener => listener()));
    expect(button("clear-selection").getAttribute("data-color")).toBe("secondary");
    await click("clear-selection");
    expect([button("clear-selection"), plugin.managers.structure.selection.stats.elementCount]).toEqual([null, 0]);
    expect(calls.slice(-2)).toEqual([["clear-preview"], ["clear-selection"]]);
    for (const name of ["spin", "rock", "off"]) {
      motion = name;
      await act(async () => api.animate());
      expect([button("animate").dataset.motion, button("animate").hasAttribute("data-selected")]).toEqual([name, name !== "off"]);
    }
    wiggle = "uniform";
    await act(async () => api.animate());
    expect(button("animate").dataset.motion).toBe("wiggle");
    trajectory = true;
    await act(async () => api.animate());
    expect(button("animate").dataset.motion).toBe("playing");
    trajectory = false; wiggle = "off"; plugin.managers.animation.state.animationState = "playing";
    await act(async () => listeners.forEach(listener => listener()));
    expect(button("animate").dataset.motion).toBe("playing");
    plugin.managers.animation.state.animationState = "stopped";
    await act(async () => listeners.forEach(listener => listener()));
    expect([button("animate").dataset.motion, button("animate").hasAttribute("data-selected")]).toEqual(["off", false]);
    await click("select-mode");
    expect(document.getElementById("buret-selection-bar")!.classList.contains("hidden")).toBe(true);
    // Radix tooltip owns both the portal and the accessible description. It is
    // outside the draggable/backdrop-filtered rail and follows the viewer theme.
    await act(async () => button("illumination").focus());
    expect([document.querySelector(".buret-viewport-tooltip")?.getAttribute("data-effective-theme"), rail.querySelector(".buret-viewport-tooltip")]).toEqual(["dark", null]);
    expect(button("illumination").hasAttribute("aria-describedby")).toBe(true);
    await act(async () => button("illumination").blur());
    theme = "light";
    await act(async () => button("illumination").focus());
    expect(document.querySelector(".buret-viewport-tooltip")?.getAttribute("data-effective-theme")).toBe("light");
    await click("illumination");
    expect(document.querySelector(".buret-viewport-tooltip")).toBeNull();
  } finally { await act(async () => api.dispose()); document.body.innerHTML = ""; }
  expect(listeners.size).toBe(0);
});

test("rail dragging skips nested button content and suppresses only the click following a drag", async () => {
  const toolbar = document.createElement("div"), rail = document.createElement("div");
  document.body.append(toolbar, rail);
  toolbar.dataset.defaultPosition = "1";
  toolbar.getBoundingClientRect = () => new DOMRect(100, 80, 200, 32);
  rail.setPointerCapture = () => {}; rail.releasePointerCapture = () => {};
  let now = 1000;
  const calls: unknown[] = [];
  const bindings = { window: browser, Date: { now: () => now },
    undockToolbar: () => calls.push("undock"), moveToolbar: (_: HTMLElement, x: number, y: number) => calls.push([x, y]),
    snapToolbarToCorner: () => calls.push("snap"), saveToolbarPosition: () => calls.push("save"),
  };
  new Function(...Object.keys(bindings), `${source("initViewportRailDrag")}; return initViewportRailDrag`)(...Object.values(bindings))(rail, toolbar);
  let controls: ReturnType<typeof mountViewerViewportToolbar>;
  await act(async () => { controls = mountViewerViewportToolbar(rail, {
    read: () => ({ illumination: false, selectionMode: false, hasSelection: false, motion: "off" }),
    styleSurface: () => {}, onAction: action => calls.push(action),
  }); });
  const button = rail.querySelector("button")!;
  const pointer = (target: Element, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
  try {
    pointer(button.querySelector("path")!, "pointerdown", 100, 80);
    pointer(rail, "pointermove", 120, 100);
    pointer(rail, "pointerup", 120, 100);
    await act(async () => button.click());
    expect(calls).toEqual(["camera"]);
    pointer(rail, "pointerdown", 100, 80);
    pointer(rail, "pointermove", 102, 82);
    expect(calls).toEqual(["camera"]);
    pointer(rail, "pointermove", 120, 100);
    pointer(rail, "pointerup", 120, 100);
    expect(calls).toEqual(["camera", "undock", [120, 100], [120, 100], "snap", "save"]);
    await act(async () => button.click());
    expect(calls.at(-1)).toBe("save");
    now += 301;
    await act(async () => button.click());
    expect(calls.at(-1)).toBe("camera");
    expect([toolbar.dataset.defaultPosition, rail.classList.contains("buret-dragging")]).toEqual(["0", false]);
  } finally { await act(async () => controls!.dispose()); toolbar.remove(); rail.remove(); }
});
