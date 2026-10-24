import { toolbarButtonAttributes } from "../components/ui/toolbar-button";
import { styleViewerButton } from "./viewer-atlas-menu";

const boundToolbars = new WeakSet<HTMLElement>();

// Keep the DOM nodes: scientific controllers bind commands, update labels and
// visibility, and move this toolbar between floating and host-header layouts.
// Only Button's inner wrapper and shared appearance are added here.
export function styleViewerMainToolbar(toolbar: HTMLElement, tokens: Parameters<typeof styleViewerButton>[1], mode: "light" | "dark") {
  const buttons = toolbar.querySelectorAll<HTMLButtonElement>('[data-buret-toolbar-content] button, :scope > [data-drag-handle]');
  for (const button of buttons) {
    if (!button.querySelector(':scope > .atlas-button-inner')) {
      const inner = toolbar.ownerDocument.createElement("span");
      inner.className = "atlas-button-inner";
      for (const child of Array.from(button.childNodes)) {
        if (!(child instanceof Element && child.classList.contains("buret-tooltip"))) inner.append(child);
      }
      button.prepend(inner);
    }
    for (const [name, value] of Object.entries(toolbarButtonAttributes)) button.setAttribute(name, value);
    if (button.hasAttribute("data-drag-handle")) button.setAttribute("data-atlas-size", "sm");
    button.classList.add("buret-main-toolbar-button");
    button.toggleAttribute("data-uniform", button.matches('[data-buret-toggle="left"], [data-buret-toggle="right"], [data-drag-handle], .buret-mode-button, [data-buret-action="theme"], [data-buret-action="molstar-lasso"], [data-buret-action="xyzrender-tune"]'));
    styleViewerButton(button, tokens, mode);
    syncState(button);
  }
  syncVisibility(toolbar);
  if (boundToolbars.has(toolbar)) return;
  boundToolbars.add(toolbar);
  new MutationObserver(records => {
    for (const { target } of records) {
      if (target === toolbar) syncVisibility(toolbar);
      if (target instanceof HTMLButtonElement && target.classList.contains("buret-main-toolbar-button")) syncState(target);
    }
  }).observe(toolbar, { subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed", "disabled"] });
}

function syncVisibility(toolbar: HTMLElement) {
  const content = toolbar.querySelector<HTMLElement>("[data-buret-toolbar-content]");
  if (!content) return;
  const hidden = toolbar.classList.contains("collapsed") || toolbar.classList.contains("buret-suppressed-by-molstar-panel");
  if (hidden && content.contains(toolbar.ownerDocument.activeElement)) toolbar.querySelector<HTMLButtonElement>("[data-drag-handle]")?.focus();
  content.inert = hidden;
}

function syncState(button: HTMLButtonElement) {
  button.toggleAttribute("data-selected", button.classList.contains("active") || button.getAttribute("aria-pressed") === "true");
  button.toggleAttribute("data-disabled", button.disabled);
}
