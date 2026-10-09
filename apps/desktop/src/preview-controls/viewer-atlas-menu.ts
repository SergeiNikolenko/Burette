import tokens from "../styles/codex-tokens.css" with { type: "text" };
import menuStyles from "../components/ui/dropdown-menu.css" with { type: "text" };
import popoverStyles from "../components/ui/popover-surface.css" with { type: "text" };
import buttonStyles from "../components/ui/button.atlas.css" with { type: "text" };
import buttonBehavior from "../components/ui/button.css" with { type: "text" };
import loadingStyles from "../components/ui/loading-indicator.atlas.css" with { type: "text" };
import sliderStyles from "../components/ui/slider.atlas.css" with { type: "text" };
import segmentedStyles from "../components/ui/segmented-control.css" with { type: "text" };
import commandStyles from "../components/ui/command.atlas.css" with { type: "text" };
import selectStyles from "../components/ui/select.atlas.css" with { type: "text" };
import selectMenuStyles from "../components/ui/select-menu.atlas.css" with { type: "text" };
import selectBehavior from "../components/ui/select.css" with { type: "text" };
import paletteStyles from "../components/ui/color-palette.css" with { type: "text" };
import selectionBehavior from "./viewer-selection-controls.css" with { type: "text" };
import { buttonPressScale } from "../components/ui/button-press-scale";
import behavior from "./viewer-atlas-menu.css" with { type: "text" };
import { buildCodexThemeVariables, CODEX_DEFAULT_THEME } from "../lib/codex-theme";

type ThemeTokens = Partial<Record<"light" | "dark", {
  accent?: string; background?: string; foreground?: string; contrast?: number;
}>>;

// The standalone viewer has no Tailwind layers or shell stylesheet. Scope the
// original tokens to the popup and use the same Menu stylesheet, unlayered.
// Keeping it in the existing controls bundle avoids new runtime asset URLs.
const source = String(tokens).replaceAll(".app-shell", ".buret-atlas-surface")
  + behavior + String(popoverStyles).replace("@layer components {", "").replace(/}\s*$/, "")
  + String(menuStyles).replace("@layer components {", "").replace(/}\s*$/, "")
  + segmentedStyles + paletteStyles
  + [buttonStyles, buttonBehavior, loadingStyles, sliderStyles, commandStyles, selectStyles, selectMenuStyles, selectBehavior].map(css => String(css)
    .replace("@layer theme, base, components, utilities;", "")
    .replace("@layer components {", "").replace(/}\s*$/, "")).join("") + selectionBehavior;

export function styleViewerButton(button: HTMLButtonElement, themeTokens: ThemeTokens | undefined, mode: "light" | "dark") {
  if (!button.classList.contains("atlas-button")) {
    button.classList.add("atlas-button");
    button.addEventListener("pointerenter", () => {
      button.style.setProperty("--scale", String(buttonPressScale(button.offsetWidth)));
    });
  }
  styleViewerSurface(button, themeTokens, mode);
  button.toggleAttribute("data-disabled", button.disabled);
}

export function styleViewerMenu(menu: HTMLElement, themeTokens: ThemeTokens | undefined, mode: "light" | "dark") {
  menu.classList.add("buret-atlas-menu", "atlas-menu-content");
  styleViewerSurface(menu, themeTokens, mode);
}

export function styleViewerPopover(popover: HTMLElement, themeTokens: ThemeTokens | undefined, mode: "light" | "dark") {
  popover.classList.add("atlas-popover-surface");
  styleViewerSurface(popover, themeTokens, mode);
}

export function moveViewerMenuFocus(menu: HTMLElement, event: KeyboardEvent) {
  const active = menu.ownerDocument.activeElement as HTMLElement;
  const group = active?.closest<HTMLDetailsElement>('details');
  if (group && menu.contains(group)) {
    if (event.key === 'ArrowRight' && active.tagName === 'SUMMARY') {
      event.preventDefault();
      group.open = true;
      active.setAttribute('aria-expanded', 'true');
      group.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      group.open = false;
      const summary = group.querySelector('summary');
      summary?.setAttribute('aria-expanded', 'false');
      summary?.focus();
      return;
    }
  }
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'))
    .filter(item => !item.closest('details:not([open])') || item.tagName === 'SUMMARY');
  if (!items.length) return;
  const current = items.indexOf(active);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : event.key === "ArrowDown" ? (current + 1) % items.length
    : event.key === "ArrowUp" ? (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length) : -1;
  if (next < 0) return;
  event.preventDefault();
  items.forEach((item, index) => { item.tabIndex = index === next ? 0 : -1; });
  items[next].focus();
}

function styleViewerSurface(menu: HTMLElement, themeTokens: ThemeTokens | undefined, mode: "light" | "dark") {
  const document = menu.ownerDocument;
  if (!document.getElementById("buret-atlas-menu-styles")) {
    const style = document.createElement("style");
    style.id = "buret-atlas-menu-styles";
    style.textContent = source;
    document.head.appendChild(style);
  }
  menu.classList.add("buret-atlas-surface");
  menu.dataset.effectiveTheme = mode;
  const input = themeTokens?.[mode];
  const defaults = CODEX_DEFAULT_THEME[mode];
  const color = (value: string | undefined, fallback: string) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const variables = buildCodexThemeVariables({
    accent: color(input?.accent, defaults.accent),
    surface: color(input?.background, defaults.surface),
    ink: color(input?.foreground, defaults.ink),
    contrast: Number.isFinite(input?.contrast) ? Math.min(100, Math.max(0, input!.contrast!)) : defaults.contrast,
  }, mode);
  for (const [name, value] of Object.entries(variables)) menu.style.setProperty(name, value);
}
