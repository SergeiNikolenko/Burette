import type { Plugin } from "vite";

// Ketcher's module stylesheet hard-codes its own UI palette (teal actions,
// blue-gray panels, #333 ink). Map those colors onto the Atlas theme tokens so
// every native surface Ketcher still renders follows light and dark themes.
// Chemistry colors live in the canvas SVG and the periodic-table group pastels
// are not in this palette, so both stay untouched.
type Role = "surface" | "line" | "ink";
type Swatch = Record<Role, string>;

const hover = "color-mix(in srgb,var(--foreground) 84%,var(--background))";
const tint = "color-mix(in srgb,var(--destructive) 12%,transparent)";
const thumb = "color-mix(in srgb,var(--muted-foreground) 50%,transparent)";
const swatch = (surface: string, line: string, ink: string): Swatch => ({ surface, line, ink });

const palette: Array<[string[], Swatch]> = [
  [["#167782", "#188794", "#00838f", "#005662"], swatch("var(--foreground)", "var(--ring)", "var(--foreground)")],
  [["#4fb3bf", "#43b5c0"], swatch(hover, "var(--ring)", "var(--foreground)")],
  [["rgba(22,119,130,.05)"], swatch("var(--muted)", "var(--border)", "var(--muted)")],
  [["rgba(0,131,143,.4)"], swatch("var(--ring)", "var(--ring)", "var(--ring)")],
  [["#eff2f5", "#e1e5ea", "#e1e6ed", "#f3f3f3", "#f3f5f7", "#f3f8f9", "#f9fafb", "#fcfcfc", "rgba(243,245,247,.6)"], swatch("var(--muted)", "var(--border)", "var(--muted-foreground)")],
  [["#ffffff", "#fff"], swatch("var(--popover)", "var(--border)", "var(--background)")],
  [["#333333", "#333", "#000000", "#000", "rgba(51,51,51,.8)"], swatch("var(--foreground)", "var(--ring)", "var(--foreground)")],
  [["#585858", "#717171", "rgba(88,88,88,.7)", "rgba(51,51,51,.6)", "rgba(64,64,64,.75)", "rgba(82,82,82,.4)"], swatch("var(--muted-foreground)", "var(--input)", "var(--muted-foreground)")],
  [["#cad3dd", "#b4b9d6", "#dddddd", "#ddd", "#c5c5c5", "#a5afb9", "rgba(165,175,185,.85)"], swatch(thumb, "var(--input)", "var(--muted-foreground)")],
  [["#f40724", "#ff4a4a"], swatch("var(--destructive)", "var(--destructive)", "var(--destructive)")],
  [["#fde0df", "rgba(244,7,36,.12)"], swatch(tint, tint, tint)],
];

function role(property: string): Role {
  const name = property.trim().toLowerCase();
  if (/background|bgcolor|surface|tab-regular|dropdown-secondary|tooltip-background/.test(name)) return "surface";
  if (/border|outline|divider|shadow/.test(name)) return "line";
  return "ink";
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = palette.map(([values, colors]) => [new RegExp(`(?:${values.map(escape).join("|")})(?![0-9a-fA-F])`, "gi"), colors] as const);

export function recolorKetcherCss(css: string) {
  // Only declaration values change; selectors, data URIs and SVG markup do not.
  return css.replace(/([{;]\s*)(--[\w-]+|[a-z-]+)(\s*:)([^;{}]*)/gi, (match, lead: string, property: string, colon: string, value: string) => {
    if (/url\(/i.test(value)) return match;
    const kind = role(property);
    let next = value;
    for (const [pattern, colors] of patterns) next = next.replace(pattern, colors[kind]);
    return lead + property + colon + next;
  });
}

export function ketcherPalettePlugin(): Plugin {
  return {
    name: "atlas-ketcher-palette",
    enforce: "pre",
    transform(code, id) {
      if (!/\/ketcher-react\/dist\/index\.css(?:$|\?)/.test(id.replaceAll("\\", "/"))) return null;
      return { code: recolorKetcherCss(code), map: null };
    },
  };
}
