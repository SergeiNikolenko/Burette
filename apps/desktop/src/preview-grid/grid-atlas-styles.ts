import tokens from "../styles/codex-tokens.css" with { type: "text" };
import selectMenu from "../components/ui/select-menu.atlas.css" with { type: "text" };
import selectControl from "../components/ui/select.atlas.css" with { type: "text" };
import searchInput from "../components/ui/search-input.css" with { type: "text" };
import selectBehavior from "../components/ui/select.css" with { type: "text" };
import segmentedControl from "../components/ui/segmented-control.css" with { type: "text" };
import button from "../components/ui/button.atlas.css" with { type: "text" };
import buttonBehavior from "../components/ui/button.css" with { type: "text" };
import tooltip from "../components/ui/tooltip.atlas.css" with { type: "text" };
import tooltipBehavior from "../components/ui/tooltip.css" with { type: "text" };
import menu from "../components/ui/dropdown-menu.css" with { type: "text" };
import { buildCodexThemeVariables, codexThemeFromTokens, type CodexThemeTokens } from "../lib/codex-theme";

// Grid runs in a standalone iframe without the shell stylesheet. Embed the same
// generated Atlas source, adapting only its theme scope to the viewer contract.
// No extra asset URL is needed in Quick Look, srcdoc or packaged plugin previews.
const source = (String(tokens) + selectControl + selectMenu + selectBehavior + searchInput + segmentedControl + button + buttonBehavior + tooltip + tooltipBehavior + menu)
  .replaceAll(".app-shell", ":root")
  .replaceAll("data-effective-theme", "data-buret-theme");

type ThemeTokens = Partial<Record<"light" | "dark", CodexThemeTokens>>;

export function gridAtlasStyles(themeTokens?: ThemeTokens) {
  return source + (["light", "dark"] as const).map(mode => {
    const variables = buildCodexThemeVariables(codexThemeFromTokens(themeTokens?.[mode], mode), mode);
    return `:root[data-buret-theme="${mode}"]{${Object.entries(variables).map(([name, value]) => `${name}:${value}`).join(";")}}`;
  }).join("");
}
