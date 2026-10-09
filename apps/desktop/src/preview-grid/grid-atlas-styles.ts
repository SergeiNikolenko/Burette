import tokens from "../styles/codex-tokens.css" with { type: "text" };
import selectMenu from "../components/ui/select-menu.atlas.css" with { type: "text" };
import selectBehavior from "../components/ui/select.css" with { type: "text" };
import segmentedControl from "../components/ui/segmented-control.css" with { type: "text" };
import button from "../components/ui/button.atlas.css" with { type: "text" };
import buttonBehavior from "../components/ui/button.css" with { type: "text" };
import tooltip from "../components/ui/tooltip.atlas.css" with { type: "text" };
import tooltipBehavior from "../components/ui/tooltip.css" with { type: "text" };
import menu from "../components/ui/dropdown-menu.css" with { type: "text" };
import { buildCodexThemeVariables, CODEX_DEFAULT_THEME } from "../lib/codex-theme";

// Grid runs in a standalone iframe without the shell stylesheet. Embed the same
// generated Atlas source, adapting only its theme scope to the viewer contract.
// No extra asset URL is needed in Quick Look, srcdoc or packaged plugin previews.
const source = (String(tokens) + selectMenu + selectBehavior + segmentedControl + button + buttonBehavior + tooltip + tooltipBehavior + menu)
  .replaceAll(".app-shell", ":root")
  .replaceAll("data-effective-theme", "data-buret-theme");

type ThemeTokens = Partial<Record<"light" | "dark", {
  accent?: string; background?: string; foreground?: string; contrast?: number;
}>>;

export function gridAtlasStyles(themeTokens?: ThemeTokens) {
  return source + (["light", "dark"] as const).map(mode => {
    const input = themeTokens?.[mode];
    const defaults = CODEX_DEFAULT_THEME[mode];
    const color = (value: string | undefined, fallback: string) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    const variables = buildCodexThemeVariables({
      accent: color(input?.accent, defaults.accent),
      surface: color(input?.background, defaults.surface),
      ink: color(input?.foreground, defaults.ink),
      contrast: Number.isFinite(input?.contrast) ? Math.min(100, Math.max(0, input!.contrast!)) : defaults.contrast,
    }, mode);
    return `:root[data-buret-theme="${mode}"]{${Object.entries(variables).map(([name, value]) => `${name}:${value}`).join(";")}}`;
  }).join("");
}
