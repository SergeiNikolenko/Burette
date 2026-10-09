import tokens from "../styles/codex-tokens.css" with { type: "text" };
import menuStyles from "../components/ui/dropdown-menu.css" with { type: "text" };
import popoverStyles from "../components/ui/popover-surface.css" with { type: "text" };
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
  + String(menuStyles).replace("@layer components {", "").replace(/}\s*$/, "");

export function styleViewerMenu(menu: HTMLElement, themeTokens: ThemeTokens | undefined, mode: "light" | "dark") {
  menu.classList.add("buret-atlas-menu", "atlas-menu-content");
  styleViewerSurface(menu, themeTokens, mode);
}

export function styleViewerPopover(popover: HTMLElement, themeTokens: ThemeTokens | undefined, mode: "light" | "dark") {
  popover.classList.add("atlas-popover-surface");
  styleViewerSurface(popover, themeTokens, mode);
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
