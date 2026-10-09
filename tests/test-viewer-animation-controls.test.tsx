import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { mountViewerAnimationControls } = await import("../apps/desktop/src/preview-controls/viewer-animation-controls");
const viewer = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
const source = (name: string) => {
  const start = viewer.search(new RegExp(`  (?:async )?function ${name}\\(`));
  return viewer.slice(start, viewer.indexOf("\n  }", start) + 4);
};
const constant = (name: string) => viewer.slice(viewer.indexOf(`  const ${name} =`), viewer.indexOf(";", viewer.indexOf(`  const ${name} =`)) + 1);

test("real Animate builder uses shared controls, live scene state, keyboard sliders and disposes its root", async () => {
  const writes: unknown[] = [];
  const canvas = { props: { trackball: { animate: { name: "off", params: {} } } }, setProps(value: { trackball: typeof canvas.props.trackball }) { canvas.props = value; writes.push(value); } };
  const component = {
    state: { options: { animation: { wiggleAmplitude: 0, wiggleSpeed: 7, wiggleFrequency: .2, tumbleAmplitude: 0, tumbleSpeed: 1, tumbleFrequency: .2, wiggleMode: "position" } } },
    async setOptions(options: typeof component.state.options) { component.state.options = options; writes.push(options); },
  };
  const plugin = { canvas3d: canvas, managers: { structure: { component }, animation: { animations: [] } } };
  const bindings = {
    document, window: { BuretteNativeViewerMenus: { stylePopover: () => {}, mountAnimationControls: mountViewerAnimationControls } },
    viewportPlugin: () => plugin, viewportWiggleLayerRefs: () => [], clearViewportWiggleLayers: async () => {},
    applyViewportWiggleFromUncertainty: async () => 0,
    activeConfig: {}, activeTrajectoryPlaybackControl: null, resolveViewerTheme: () => "dark",
    positionOpenViewportMenu: () => {}, updateViewportAnimateState: () => {}, setStatus: () => {}, debug: () => {},
    sceneTreeMenuSection: () => {}, viewportMenuItem: () => {},
  };
  const constants = ["VIEWPORT_MOTIONS", "VIEWPORT_MOTION_SPEEDS", "VIEWPORT_CONTEXT_ANIMATIONS", "VIEWPORT_WIGGLES", "VIEWPORT_WIGGLE_MODES", "VIEWPORT_WIGGLE_SLIDERS"].map(constant).join("\n");
  const methods = ["viewportAnimateMenu", "viewportMotionState", "viewportWiggleState", "refreshViewportWiggleControls", "setViewportMotion", "setViewportWiggleOptions", "runViewportWiggleAction", "streamViewportWiggleOption", "closeViewportMenu"].map(source).join("\n");
  const api = new Function(...Object.keys(bindings), `let viewportMenuControls = null; let viewportWigglePendingWrite = null; let viewportWiggleWriteInFlight = false; ${constants}\n${methods}; return {build: viewportAnimateMenu, close: closeViewportMenu, refresh: refreshViewportWiggleControls};`)(...Object.values(bindings));
  const menu = document.createElement("div"); menu.id = "buret-viewport-menu"; document.body.append(menu);
  const radios = (group: string) => menu.querySelector(`[aria-label="${group}"]`)?.querySelectorAll<HTMLButtonElement>("button");
  const select = async (group: string, text: string) => {
    const button = Array.from(radios(group) || []).find(button => button.textContent === text)!;
    await act(async () => button.click());
  };
  const sliders = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="slider"]'));
  try {
    await act(async () => api.build(menu));
    expect(menu.getAttribute("role")).toBe("dialog");
    expect(Array.from(menu.querySelectorAll("legend")).map(node => node.textContent)).toEqual(["Motion", "Wiggle"]);
    expect(sliders()).toHaveLength(0);
    await select("Scene motion", "Spin");
    expect(canvas.props.trackball.animate).toEqual({ name: "spin", params: { axis: [0, -1, 0], speed: .1 } });
    expect(sliders().map(node => node.getAttribute("aria-label"))).toEqual(["Motion speed"]);
    await act(async () => sliders()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(canvas.props.trackball.animate.params).toEqual({ axis: [0, -1, 0], speed: .11 });
    await select("Scene motion", "Rock");
    expect(sliders()[0].getAttribute("aria-valuemax")).toBe("1.5");
    await select("Structure wiggle", "Even");
    expect(sliders().map(node => node.getAttribute("aria-label"))).toEqual(["Motion speed", "Wiggle amplitude", "Wiggle speed", "Wiggle noise scale", "Wiggle tumble"]);
    await act(async () => sliders()[4].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(component.state.options.animation.tumbleAmplitude).toBe(.1);
    expect(sliders()).toHaveLength(7);
    await select("Wiggle noise", "Independent");
    expect(component.state.options.animation.wiggleMode).toBe("group");
    await select("Scene motion", "Off");
    await select("Structure wiggle", "Off");
    expect(sliders()).toHaveLength(0);
    expect(component.state.options.animation.wiggleAmplitude).toBe(0);
    await select("Structure wiggle", "B-factor");
    // A structure with no uncertainty spread must not keep the temporary
    // baseline motion or display controls for an effect that was not applied.
    expect(sliders()).toHaveLength(0);
    expect(component.state.options.animation.wiggleAmplitude).toBe(0);
    await act(async () => api.close());
    expect(menu.isConnected).toBe(false);
    const count = writes.length;
    await act(async () => api.refresh());
    expect(writes).toHaveLength(count);
  } finally { await act(async () => api.close()); menu.remove(); }
});
