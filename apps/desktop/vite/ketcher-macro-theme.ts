// Ketcher's macromolecules editor styles its Emotion components from a theme
// object (EditorContainer `theme` prop, merged over its teal defaults). Its
// values are only interpolated into CSS strings, so Atlas tokens can be passed
// as CSS variables and follow the light, dark and codex skins. Monomer and
// peptide colors are chemistry encoding and keep their native values.
const hover = "color-mix(in srgb,var(--foreground) 84%,var(--background))";
const faint = "color-mix(in srgb,var(--muted-foreground) 40%,transparent)";
const font = "var(--font-sans)";

export const ketcherMacroTheme = {
  color: {
    background: { canvas: "var(--background)", primary: "var(--background)", secondary: "var(--muted)" },
    border: { primary: "var(--border)", secondary: "var(--input)" },
    text: {
      primary: "var(--foreground)", secondary: "var(--muted-foreground)", light: "var(--muted-foreground)",
      dark: "var(--foreground)", error: "var(--destructive)", lightgrey: "var(--muted-foreground)",
    },
    tab: { regular: "var(--background)", active: "var(--muted)", hover: "var(--foreground)", content: "var(--background)" },
    scroll: { regular: "var(--muted-foreground)", inactive: "var(--border)" },
    button: {
      primary: { active: "var(--foreground)", hover, clicked: hover, disabled: faint },
      secondary: { active: "var(--muted-foreground)", hover: "var(--foreground)", clicked: "var(--input)", disabled: faint },
      group: { active: "var(--foreground)", hover },
      text: { primary: "var(--background)", secondary: "var(--foreground)", disabled: "var(--muted-foreground)" },
    },
    dropdown: { primary: "var(--foreground)", secondary: "var(--popover)", hover: "var(--muted)", disabled: "var(--muted-foreground)" },
    tooltip: { background: "var(--popover)", text: "var(--popover-foreground)" },
    link: { active: "var(--foreground)", hover: "var(--muted-foreground)" },
    divider: "var(--border)",
    spinner: "var(--muted-foreground)",
    error: "var(--destructive)",
    input: {
      text: { default: "var(--muted-foreground)", active: "var(--foreground)", disabled: "var(--muted-foreground)", error: "var(--destructive)" },
      background: { primary: "var(--background)", default: "var(--background)", hover: "var(--muted)", disabled: "var(--muted)" },
      border: { regular: "var(--input)", active: "var(--ring)", hover: "var(--ring)", focus: "var(--ring)", error: "var(--destructive)" },
    },
    icon: {
      grey: "var(--muted-foreground)", hover: "var(--foreground)", active: "var(--foreground)",
      activeMenu: "var(--foreground)", clicked: "var(--background)", disabled: faint,
    },
    editMode: { sequenceInRNABuilder: "var(--ring)" },
  },
  font: { family: { montserrat: font, inter: font, roboto: font } },
  border: { regular: "1px solid var(--border)", small: "1px solid var(--border)", radius: { regular: "var(--radius-md)" } },
  shadow: { regular: "none", mainLayoutBlocks: "none" },
  outline: {
    small: "1px solid var(--input)", medium: "2px solid var(--input)", color: "var(--input)",
    selected: { color: "var(--foreground)", small: "1px solid var(--ring)", medium: "2px solid var(--foreground)" },
    grey: { small: "1px solid var(--muted-foreground)" },
  },
};
