// The Codex desktop theme: four base values (accent, surface, ink, contrast)
// expand into the --app-color-* variables that styles/codex-tokens.css builds
// every other token from. The arithmetic follows the Codex desktop app so the
// same inputs give the same colors.

export type CodexThemeVariant = "light" | "dark";

export type CodexTheme = {
  accent: string;
  surface: string;
  ink: string;
  contrast: number;
};

type Rgb = { red: number; green: number; blue: number };

const BLACK: Rgb = { red: 0, green: 0, blue: 0 };
const WHITE: Rgb = { red: 255, green: 255, blue: 255 };

export const CODEX_DEFAULT_THEME: Record<CodexThemeVariant, CodexTheme> = {
  light: { accent: "#339cff", surface: "#ffffff", ink: "#1a1c1f", contrast: 45 },
  dark: { accent: "#339cff", surface: "#181818", ink: "#ffffff", contrast: 60 },
};

const SEMANTIC = {
  light: { diffAdded: "#00a240", diffRemoved: "#ba2623", skill: "#924ff7" },
  dark: { diffAdded: "#40c977", diffRemoved: "#fa423e", skill: "#ad7bf9" },
};
const SURFACE_UNDER_BASE = { light: 0.04, dark: 0.16 };
const SURFACE_UNDER_SLOPE = { light: 0.0012, dark: 0.0015 };
const PANEL_BASE = { light: 0.18, dark: 0.03 };
const PANEL_SLOPE = { light: 0.008, dark: 0.03 };

function parseHex(color: string): Rgb {
  const hex = color.slice(1);
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.min(1, Math.max(0, amount));
  const channel = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { red: channel(from.red, to.red), green: channel(from.green, to.green), blue: channel(from.blue, to.blue) };
}

const hex = (color: Rgb) => `#${[color.red, color.green, color.blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
const rgb = (color: Rgb) => `rgb(${color.red}, ${color.green}, ${color.blue})`;
const mixHex = (from: Rgb, to: Rgb, amount: number) => hex(mix(from, to, amount));

function alpha(color: Rgb, amount: number) {
  const value = Math.min(1, Math.max(0, amount)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${value})`;
}

function luminance(color: Rgb) {
  const linear = (value: number) => {
    const unit = value / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return linear(color.red) * 0.2126 + linear(color.green) * 0.7152 + linear(color.blue) * 0.0722;
}

function textOnAccent(accent: Rgb): Rgb {
  if (accent.blue > accent.red && accent.blue > accent.green) {
    const chroma = accent.blue - Math.min(accent.red, accent.green);
    const hue = ((accent.red - accent.green) / chroma + 4) * 60;
    const saturation = chroma / accent.blue;
    if ((saturation >= 0.8 && hue >= 205 && hue <= 212) || (saturation >= 0.6 && hue >= 218 && hue <= 233 && luminance(accent) <= 0.21)) return WHITE;
  }
  return luminance(accent) > 0.179 ? BLACK : WHITE;
}

function scaledContrast(contrast: number, variant: CodexThemeVariant) {
  const reference = CODEX_DEFAULT_THEME[variant].contrast;
  const value = contrast / 100 + ((contrast - reference) / 60) * 0.7;
  return contrast <= reference ? value : reference / 100 + (value - reference / 100) * 2;
}

function isDefault(theme: CodexTheme, variant: CodexThemeVariant) {
  const reference = CODEX_DEFAULT_THEME[variant];
  return theme.accent === reference.accent && theme.surface === reference.surface && theme.ink === reference.ink && theme.contrast === reference.contrast;
}

function lightParts(surface: Rgb, ink: Rgb, accent: Rgb, c: number, theme: CodexTheme) {
  const control = mix(surface, WHITE, 0.09 + c * 0.04);
  const elevatedSecondary = mix(surface, WHITE, 0.08 + c * 0.08);
  const elevatedPrimary = mix(surface, WHITE, 0.16 + c * 0.12);
  return {
    accentBackground: mixHex(surface, accent, 0.11 + c * 0.04),
    accentBackgroundActive: mixHex(surface, accent, 0.13 + c * 0.05),
    accentBackgroundHover: mixHex(surface, accent, 0.12 + c * 0.045),
    border: alpha(ink, 0.06 + c * 0.04),
    borderFocus: theme.accent,
    borderHeavy: alpha(ink, 0.09 + c * 0.06),
    borderLight: alpha(ink, 0.04 + c * 0.02),
    buttonPrimaryBackground: theme.ink,
    buttonPrimaryBackgroundActive: alpha(ink, 0.1 + c * 0.12),
    buttonPrimaryBackgroundHover: alpha(ink, 0.05 + c * 0.06),
    buttonPrimaryBackgroundInactive: alpha(ink, 0.18 + c * 0.14),
    buttonSecondaryBackground: alpha(ink, 0.04 + c * 0.02),
    buttonSecondaryBackgroundActive: alpha(ink, 0.03 + c * 0.02),
    buttonSecondaryBackgroundHover: alpha(ink, 0.04 + c * 0.03),
    buttonSecondaryBackgroundInactive: alpha(ink, 0.01 + c * 0.02),
    buttonTertiaryBackground: alpha(ink, 0),
    buttonTertiaryBackgroundActive: alpha(ink, 0.16 + c * 0.08),
    buttonTertiaryBackgroundHover: alpha(ink, 0.08 + c * 0.04),
    controlBackground: alpha(control, 0.96),
    controlBackgroundOpaque: rgb(control),
    elevatedPrimary: alpha(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: rgb(elevatedPrimary),
    elevatedSecondary: alpha(elevatedSecondary, 0.96),
    elevatedSecondaryOpaque: rgb(elevatedSecondary),
    iconAccent: theme.accent,
    iconPrimary: theme.ink,
    iconSecondary: alpha(ink, 0.65 + c * 0.1),
    iconTertiary: alpha(ink, 0.45 + c * 0.1),
    simpleScrim: alpha(BLACK, 0.08 + c * 0.04),
    textAccent: theme.accent,
    textButtonPrimary: theme.surface,
    textButtonSecondary: theme.ink,
    textButtonTertiary: alpha(ink, 0.45 + c * 0.1),
    textForeground: theme.ink,
    textForegroundSecondary: alpha(ink, 0.65 + c * 0.1),
    textForegroundTertiary: alpha(ink, 0.45 + c * 0.1),
  };
}

function darkParts(surface: Rgb, ink: Rgb, accent: Rgb, c: number, theme: CodexTheme): ReturnType<typeof lightParts> {
  const control = mix(surface, ink, 0.06 + c * 0.05);
  const accentText = mix(accent, WHITE, 0.3 + c * 0.15);
  const primaryButton = mix(surface, BLACK, 0.38 + c * 0.12);
  const elevatedPrimary = mix(surface, ink, 0.08 + c * 0.08);
  return {
    accentBackground: mixHex(BLACK, accent, 0.2 + c * 0.08),
    accentBackgroundActive: mixHex(BLACK, accent, 0.22 + c * 0.12),
    accentBackgroundHover: mixHex(BLACK, accent, 0.21 + c * 0.1),
    border: alpha(ink, 0.06 + c * 0.04),
    borderFocus: alpha(accentText, 0.7 + c * 0.1),
    borderHeavy: alpha(ink, 0.12 + c * 0.06),
    borderLight: alpha(ink, 0.03 + c * 0.02),
    buttonPrimaryBackground: rgb(primaryButton),
    buttonPrimaryBackgroundActive: alpha(ink, 0.07 + c * 0.05),
    buttonPrimaryBackgroundHover: alpha(ink, 0.04 + c * 0.03),
    buttonPrimaryBackgroundInactive: alpha(ink, 0.02 + c * 0.02),
    buttonSecondaryBackground: alpha(ink, 0.04 + c * 0.02),
    buttonSecondaryBackgroundActive: alpha(ink, 0.09 + c * 0.05),
    buttonSecondaryBackgroundHover: alpha(ink, 0.06 + c * 0.03),
    buttonSecondaryBackgroundInactive: alpha(ink, 0.02 + c * 0.03),
    buttonTertiaryBackground: alpha(ink, 0.02 + c * 0.015),
    buttonTertiaryBackgroundActive: alpha(ink, 0.07 + c * 0.05),
    buttonTertiaryBackgroundHover: alpha(ink, 0.05 + c * 0.03),
    controlBackground: alpha(control, 0.96),
    controlBackgroundOpaque: rgb(control),
    elevatedPrimary: alpha(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: rgb(elevatedPrimary),
    elevatedSecondary: alpha(ink, 0.02 + c * 0.02),
    elevatedSecondaryOpaque: mixHex(surface, ink, 0.04 + c * 0.05),
    iconAccent: rgb(accentText),
    iconPrimary: alpha(ink, 0.82 + c * 0.14),
    iconSecondary: alpha(ink, 0.65 + c * 0.1),
    iconTertiary: alpha(ink, 0.45 + c * 0.1),
    simpleScrim: alpha(ink, 0.08 + c * 0.04),
    textAccent: rgb(accentText),
    textButtonPrimary: rgb(primaryButton),
    textButtonSecondary: mixHex(ink, surface, 0.7 + c * 0.1),
    textButtonTertiary: alpha(ink, 0.45 + c * 0.1),
    textForeground: isDefault(theme, "dark") ? "var(--gray-fixed-150)" : theme.ink,
    textForegroundSecondary: alpha(ink, 0.65 + c * 0.1),
    textForegroundTertiary: alpha(ink, 0.42 + c * 0.13),
  };
}

export function buildCodexThemeVariables(theme: CodexTheme, variant: CodexThemeVariant): Record<string, string> {
  const surface = parseHex(theme.surface);
  const ink = parseHex(theme.ink);
  const accent = parseHex(theme.accent);
  const c = scaledContrast(theme.contrast, variant);
  const semantic = SEMANTIC[variant];
  const light = variant === "light";
  const parts = light ? lightParts(surface, ink, accent, c, theme) : darkParts(surface, ink, accent, c, theme);
  const underAmount = SURFACE_UNDER_BASE[variant] + (theme.contrast - CODEX_DEFAULT_THEME[variant].contrast) * SURFACE_UNDER_SLOPE[variant];
  const surfaceUnder = mixHex(surface, light ? ink : BLACK, underAmount);
  const editor = light ? mix(surface, WHITE, 0.12) : mix(surface, ink, 0.07);
  const menu = mix(surface, ink, 0.02 + c * 0.02);
  return {
    "--codex-base-accent": theme.accent,
    "--codex-base-contrast": String(theme.contrast),
    "--codex-base-ink": theme.ink,
    "--codex-base-surface": theme.surface,
    "--color-background-composer-primary": "var(--color-background-primary-solid)",
    "--color-text-composer-primary": "var(--color-text-primary-solid)",
    "--color-background-user-message": "color-mix(in oklab, var(--color-text) 5%, transparent)",
    "--color-text-user-message": "var(--color-text)",
    "--color-background-text-selection": "var(--color-background-info-soft)",
    "--color-background-attribution-highlight": "var(--color-background-info-soft)",
    "--app-color-accent-blue": theme.accent,
    "--app-color-accent-purple": semantic.skill,
    "--app-color-background-accent": parts.accentBackground,
    "--app-color-background-accent-active": parts.accentBackgroundActive,
    "--app-color-background-accent-hover": parts.accentBackgroundHover,
    "--app-color-background-application-menu": hex(menu),
    "--app-color-background-button-primary": parts.buttonPrimaryBackground,
    "--app-color-background-button-primary-active": parts.buttonPrimaryBackgroundActive,
    "--app-color-background-button-primary-hover": parts.buttonPrimaryBackgroundHover,
    "--app-color-background-button-primary-inactive": parts.buttonPrimaryBackgroundInactive,
    "--app-color-background-button-secondary": parts.buttonSecondaryBackground,
    "--app-color-background-button-secondary-active": parts.buttonSecondaryBackgroundActive,
    "--app-color-background-button-secondary-hover": parts.buttonSecondaryBackgroundHover,
    "--app-color-background-button-secondary-inactive": parts.buttonSecondaryBackgroundInactive,
    "--app-color-background-button-tertiary": parts.buttonTertiaryBackground,
    "--app-color-background-button-tertiary-active": parts.buttonTertiaryBackgroundActive,
    "--app-color-background-button-tertiary-hover": parts.buttonTertiaryBackgroundHover,
    "--color-background-callout-surface": parts.elevatedPrimary,
    "--app-color-background-control": parts.controlBackground,
    "--color-background-control-opaque": parts.controlBackgroundOpaque,
    "--color-background-composer-action-bar": light ? surfaceUnder : parts.elevatedSecondaryOpaque,
    "--app-color-background-editor-opaque": rgb(editor),
    "--app-color-background-elevated-primary": parts.elevatedPrimary,
    "--app-color-background-elevated-primary-opaque": parts.elevatedPrimaryOpaque,
    "--app-color-background-elevated-secondary": parts.elevatedSecondary,
    "--app-color-background-elevated-secondary-opaque": parts.elevatedSecondaryOpaque,
    "--color-background-mode-toggle-track": light ? surfaceUnder : parts.buttonTertiaryBackgroundHover,
    "--color-background-mode-toggle-selected": light ? `color-mix(in oklab, ${parts.controlBackground} 90%, transparent)` : parts.controlBackgroundOpaque,
    "--color-background-panel": mixHex(surface, light ? WHITE : ink, PANEL_BASE[variant] + c * PANEL_SLOPE[variant]),
    "--app-color-background-surface": theme.surface,
    "--app-color-background-surface-under": surfaceUnder,
    "--app-color-border": parts.border,
    "--app-color-border-application-menu-separator": light ? parts.borderHeavy : mixHex(menu, ink, 0.28),
    "--app-color-border-focus": parts.borderFocus,
    "--app-color-border-heavy": parts.borderHeavy,
    "--app-color-border-light": parts.borderLight,
    "--color-border-mode-toggle-selected": parts.border,
    "--app-color-decoration-added": semantic.diffAdded,
    "--app-color-decoration-deleted": semantic.diffRemoved,
    "--app-color-editor-added": alpha(parseHex(semantic.diffAdded), light ? 0.15 : 0.23),
    "--app-color-editor-deleted": alpha(parseHex(semantic.diffRemoved), light ? 0.15 : 0.23),
    "--app-color-icon-accent": parts.iconAccent,
    "--app-color-icon-primary": parts.iconPrimary,
    "--app-color-icon-secondary": parts.iconSecondary,
    "--app-color-icon-tertiary": parts.iconTertiary,
    "--app-color-simple-scrim": parts.simpleScrim,
    "--app-color-text-accent": parts.textAccent,
    "--app-color-text-on-accent": rgb(textOnAccent(accent)),
    "--app-color-text-button-primary": parts.textButtonPrimary,
    "--app-color-text-button-secondary": parts.textButtonSecondary,
    "--app-color-text-button-tertiary": parts.textButtonTertiary,
    "--app-color-foreground-application-menu": light ? parts.textForeground : mixHex(menu, ink, 0.875),
    "--app-color-text-foreground": parts.textForeground,
    "--app-color-text-foreground-secondary": parts.textForegroundSecondary,
    "--app-color-text-foreground-tertiary": parts.textForegroundTertiary,
    "--color-text-mode-toggle-inactive": `color-mix(in oklab, ${parts.textForeground} 80%, transparent)`,
    "--shadow-mode-toggle-selected": "var(--shadow-md)",
    "--color-border-button-outline": "var(--color-border)",
    "--color-background-button-outline-hover": "var(--color-background-primary-ghost-hover)",
    "--color-text-button-outline": "var(--color-text)",
    "--color-text-mode-toggle-primary": "var(--color-text)",
    "--color-text-mode-toggle-accent": "var(--color-text-info)",
  };
}
