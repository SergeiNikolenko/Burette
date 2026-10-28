import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";

const browser = new Window();
for (const key of ["window", "document", "HTMLElement", "HTMLButtonElement", "Element", "Node", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
const { styleViewerMainToolbar } = await import("../apps/desktop/src/preview-controls/viewer-main-toolbar");
const viewer = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
const source = (name: string) => {
  const start = viewer.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`Missing viewer function: ${name}`);
  return viewer.slice(start, viewer.indexOf("\n  }", start) + 4);
};

test("shared toolbar appearance retains command nodes, dynamic labels, disabled state and theme updates", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const shellWindow = { setTimeout: () => {} } as { setTimeout: () => void; BuretteViewerShell?: { mountToolbar: () => void } };
  runInNewContext(readFileSync("PreviewExtension/Web/viewer-shell.js", "utf8"), { window: shellWindow, document });
  shellWindow.BuretteViewerShell!.mountToolbar();
  const toolbar = document.getElementById("buret-toolbar")!;
  const left = toolbar.querySelector<HTMLButtonElement>('[data-buret-toggle="left"]')!;
  const theme = toolbar.querySelector<HTMLButtonElement>('[data-buret-action="theme"]')!;
  const preset = toolbar.querySelector<HTMLButtonElement>('[data-buret-molstar-preset-trigger]')!;
  const save = toolbar.querySelector<HTMLButtonElement>('[data-buret-action="save-modified-structure"]')!;
  let clicks = 0;
  left.addEventListener("click", () => clicks++);
  const tokens = { dark: { background: "#181818", foreground: "#FFFFFF", accent: "#339CFF" } };
  styleViewerMainToolbar(toolbar, tokens, "dark");
  const inner = theme.querySelector(".atlas-button-inner");
  const label = preset.querySelector("[data-buret-molstar-preset-label]");
  styleViewerMainToolbar(toolbar, tokens, "dark");
  left.click();
  expect([clicks, toolbar.querySelector('[data-buret-toggle="left"]') === left, theme.querySelectorAll(".atlas-button-inner").length]).toEqual([1, true, 1]);
  expect([left.hasAttribute("data-uniform"), preset.hasAttribute("data-uniform"), left.querySelector("[data-buret-mode-icon]")?.getAttribute("data-buret-mode-icon")]).toEqual([true, false, "SidebarLeft"]);
  expect(toolbar.querySelector('[data-buret-xyzrender-popover] button')?.classList.contains("atlas-button")).toBe(false);
  save.disabled = true; left.classList.add("active");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([save.hasAttribute("data-disabled"), left.hasAttribute("data-selected")]).toEqual([true, true]);
  save.disabled = false; left.classList.remove("active"); left.setAttribute("aria-pressed", "true");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([save.hasAttribute("data-disabled"), left.hasAttribute("data-selected")]).toEqual([false, true]);
  left.setAttribute("aria-pressed", "false");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(left.hasAttribute("data-selected")).toBe(false);
  // Exercise the real controller: changing the theme must not replace Button's
  // wrapper or move the local hint inside its flex content.
  const scope = { document, viewerTheme: "dark", APP_ICON_DATA: { ThemeDark: {} },
    sceneTreeIconElement: () => document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  };
  runInNewContext(`${source("setTooltipLabel")}\n${source("updateThemeButton")}\nupdateThemeButton();`, scope);
  expect([theme.querySelector(".atlas-button-inner") === inner, inner?.querySelectorAll("svg").length, theme.querySelector(":scope > .buret-tooltip")?.textContent]).toEqual([true, 1, "Theme: dark. Switch to auto"]);
  runInNewContext(`${source("setTooltipLabel")}\n${source("updateMolstarPresetControl")}\nupdateMolstarPresetControl(document.getElementById('buret-toolbar'), 'spacefill');`, {
    window: { __buretteMolstarControlTooltipsInstalled: true }, document, activeConfig: {},
    molstarPresetOption: () => ({ value: "spacefill", label: "Spacefill by Element" }),
    populateMolstarPresetMenu: () => {}, updateMolstarAppearanceControl: () => {}, configuredMolstarAppearance: () => {},
  });
  expect([preset.querySelector("[data-buret-molstar-preset-label]") === label, label?.textContent, preset.dataset.buretHint]).toEqual([true, "Style: Spacefill by Element", "Style: Spacefill by Element"]);
  expect(preset.querySelector(".buret-tooltip")?.textContent).toBe("Style: Spacefill by Element");
  styleViewerMainToolbar(toolbar, tokens, "light");
  expect([theme.dataset.effectiveTheme, theme.querySelector(".atlas-button-inner") === inner, preset.querySelectorAll(".atlas-button-inner").length]).toEqual(["light", true, 1]);
  left.focus();
  toolbar.classList.add("collapsed");
  await new Promise(resolve => setTimeout(resolve, 0));
  const content = toolbar.querySelector<HTMLElement>("[data-buret-toolbar-content]")!;
  expect([content.inert, document.activeElement === toolbar.querySelector("[data-drag-handle]")]).toEqual([true, true]);
  toolbar.classList.remove("collapsed");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(content.inert).toBe(false);
  const grip = toolbar.querySelector<HTMLButtonElement>("[data-drag-handle]")!;
  const gripScope = {
    document, toolbar, grip,
    setXyzrenderPopoverVisibility() {}, hideMolstarPresetMenu() {}, hideGenerate3DMenu() {}, closeViewportMenu() {},
    repositionToolbar() {}, updateFloatingLayoutOffsets() {}, scheduleViewerResize() {},
  };
  for (const collapsed of [true, false]) {
    const expectedLabel = collapsed ? "Expand controls" : "Collapse controls";
    const label = runInNewContext(`${source("setToolbarCollapsed")}\n${source("molstarTooltipLabel")}\nsetToolbarCollapsed(toolbar, ${collapsed}, null, false); molstarTooltipLabel(grip);`, gripScope);
    expect([label, grip.getAttribute("aria-label"), grip.getAttribute("aria-expanded")]).toEqual([expectedLabel, expectedLabel, String(!collapsed)]);
  }
  document.body.innerHTML = "";
  browser.happyDOM.abort();
});

test("keyboard grip activation works after a captured pointer click", () => {
  const toolbar = document.createElement("div");
  toolbar.innerHTML = '<button data-drag-handle></button>';
  const grip = toolbar.querySelector("button")!;
  Object.assign(toolbar, { setPointerCapture() {}, releasePointerCapture() {} });
  let activations = 0;
  runInNewContext(`${source("initToolbarDrag")}\ninitToolbarDrag(toolbar);`, {
    toolbar, window: { addEventListener() {} }, resizeState: {},
    applyDefaultToolbarPosition() {}, activateToolbarGrip() { activations++; },
  });
  for (const type of ["pointerdown", "pointerup"]) {
    grip.dispatchEvent(new browser.PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 }));
  }
  expect(activations).toBe(1);
  // Pointer capture retargets the subsequent click to the toolbar, so the grip
  // does not receive it. The next click is the keyboard's detail=0 activation.
  toolbar.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, detail: 1 }));
  grip.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, detail: 0 }));
  expect(activations).toBe(2);
});
