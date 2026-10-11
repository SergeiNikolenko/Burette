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

// Appearance values saved before the Codex theme. A field still holding one of
// these was never customized, so it follows the Codex default instead. Quick
// Look still sends them raw when the app has never saved appearance settings.
const LEGACY_DEFAULTS: Record<CodexThemeVariant, CodexTheme> = {
  light: { accent: "#af52de", surface: "#ffffff", ink: "#0d0d0d", contrast: 20 },
  dark: { accent: "#af52de", surface: "#111111", ink: "#fcfcfc", contrast: 16 },
};

export type CodexThemeTokens = { accent?: string; background?: string; foreground?: string; contrast?: number };

// Resolves saved appearance tokens (shell preferences or viewer theme tokens).
export function codexThemeFromTokens(tokens: CodexThemeTokens | undefined, variant: CodexThemeVariant): CodexTheme {
  const legacy = LEGACY_DEFAULTS[variant];
  const fallback = CODEX_DEFAULT_THEME[variant];
  const color = (value: string | undefined, key: "accent" | "surface" | "ink") => {
    const normalized = value?.trim().toLowerCase() ?? "";
    return /^#[0-9a-f]{6}$/.test(normalized) && normalized !== legacy[key] ? normalized : fallback[key];
  };
  const contrast = typeof tokens?.contrast === "number" ? tokens.contrast : Number.NaN;
  return {
    accent: color(tokens?.accent, "accent"),
    surface: color(tokens?.background, "surface"),
    ink: color(tokens?.foreground, "ink"),
    contrast: !Number.isFinite(contrast) || contrast === legacy.contrast ? fallback.contrast : Math.min(100, Math.max(0, contrast)),
  };
}

// Base colors for the standalone viewer frames, which derive their own chrome
// variables from them next to the Codex surfaces.
export function codexThemeColors(tokens: CodexThemeTokens | undefined, variant: CodexThemeVariant) {
  const theme = codexThemeFromTokens(tokens, variant);
  return { accent: codexAccent(theme, variant), background: theme.surface, foreground: theme.ink };
}

const SEMANTIC = {
  light: { diffAdded: "#00a240", diffRemoved: "#ba2623", skill: "#924ff7" },
  dark: { diffAdded: "#40c977", diffRemoved: "#fa423e", skill: "#ad7bf9" },
};
// Codex desktop accents follow ChatGPT's accent menu unless the user picks a
// custom color. Each named accent expands from its ChatGPT palette.
const CHATGPT_PALETTES = {
  blue: { 25: "#f6fafe", 50: "#e8f3fe", 200: "#63a8f8", 300: "#539af8", 400: "#3a83f7", 500: "#2c67c5", 700: "#173e76", 800: "#133463", 900: "#0c274a" },
  green: { 25: "#effaf3", 50: "#def3e5", 200: "#83d197", 300: "#6bc67f", 400: "#53b559", 500: "#48a04c", 700: "#2c6732", 800: "#1f4e25", 900: "#14361a" },
  yellow: { 25: "#fefbee", 50: "#fdf6dc", 200: "#f9dc78", 300: "#f8d45d", 400: "#f6c543", 500: "#d9a337", 600: "#b8802b", 700: "#95611f", 800: "#734615", 900: "#51300c" },
  pink: { 25: "#fef8fb", 50: "#fdedf4", 200: "#f8a6c8", 300: "#f68ebc", 400: "#f077af", 500: "#cf6194", 700: "#873e60", 800: "#663049", 900: "#462132" },
  orange: { 25: "#fdf5f1", 50: "#fbe8db", 200: "#f1a275", 300: "#ef8b57", 400: "#ee7c37", 500: "#d25e28", 700: "#87401d", 800: "#653218", 900: "#45240d" },
  purple: { 25: "#f8f5fd", 50: "#ede5fc", 200: "#b897f4", 300: "#a67df2", 400: "#8952ee", 500: "#7849d1", 700: "#4e2f88", 800: "#3b2366", 900: "#291947" },
} as const satisfies Record<string, Record<number, string>>;

export const CHATGPT_ACCENTS = ["default", "blue", "green", "yellow", "pink", "orange", "purple", "black"] as const;
export type ChatgptAccent = (typeof CHATGPT_ACCENTS)[number];
const NAMED_SWATCHES = { blue: "#3566f0", green: "#19b79e", yellow: "#fdcd54", pink: "#fa70ab", orange: "#ff8771", purple: "#ab5eff" };
// "black" is stored as a white accent; Codex labels it White in dark mode.
const BLACK_ACCENT = "#ffffff";

// Codex `gba(name, variant)`.
function chatgptLayer(name: ChatgptAccent, variant: CodexThemeVariant) {
  const dark = variant === "dark";
  const neutral = name === "default" || name === "black";
  const palette: Record<number, string> = CHATGPT_PALETTES[neutral ? "blue" : name];
  const shade = name === "yellow" ? (dark ? 400 : 600) : dark && (name === "pink" || name === "orange") ? 400 : 500;
  let selection = dark ? `${palette[400]}${name === "yellow" ? "80" : "99"}` : `${palette[300]}59`;
  if (name === "default") selection = dark ? `${palette[200]}66` : `${palette[300]}59`;
  if (name === "black") selection = dark ? "#78787866" : "#afafaf66";
  let userMessageBackground = palette[dark ? 700 : 50];
  let userMessageText = palette[dark ? 25 : 900];
  if (neutral) {
    userMessageBackground = dark ? "rgb(50 50 50 / 85%)" : "rgb(233 233 233 / 50%)";
    userMessageText = dark ? "#ffffff" : "#0d0d0d";
  }
  if (name === "black" && !dark) {
    userMessageBackground = "#000000";
    userMessageText = "#ffffff";
  }
  return {
    accent: palette[name === "purple" ? 300 : 400],
    text: palette[shade],
    soft: palette[dark ? 800 : 50],
    submitBackground: neutral ? (dark ? "#ffffff" : "#000000") : palette[dark && name !== "pink" ? 500 : 400],
    submitText: neutral && dark ? "#000000" : "#ffffff",
    userMessageBackground,
    userMessageText,
    selection,
    attributionHighlight: name === "default" ? (dark ? "#734615" : "#fcefbe") : selection,
  };
}

// Burette stores the accent as one hex value: the Codex default stands for the
// ChatGPT default accent, and each named accent stores its palette color.
export function chatgptAccentName(theme: CodexTheme, variant: CodexThemeVariant): ChatgptAccent | null {
  const accent = theme.accent.toLowerCase();
  if (accent === CODEX_DEFAULT_THEME[variant].accent) return "default";
  if (accent === BLACK_ACCENT) return "black";
  return CHATGPT_ACCENTS.find((name) => name !== "default" && name !== "black" && chatgptLayer(name, variant).accent === accent) ?? null;
}

export function chatgptAccentValue(name: ChatgptAccent, variant: CodexThemeVariant) {
  if (name === "default") return CODEX_DEFAULT_THEME[variant].accent;
  return name === "black" ? BLACK_ACCENT : chatgptLayer(name, variant).accent;
}

export function chatgptAccentSwatch(name: ChatgptAccent, variant: CodexThemeVariant) {
  if (name === "default" || name === "black") return variant === "dark" ? "#ffffff" : "#000000";
  return NAMED_SWATCHES[name];
}
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

export function codexAccent(theme: CodexTheme, variant: CodexThemeVariant) {
  const name = chatgptAccentName(theme, variant);
  return name ? chatgptLayer(name, variant).accent : theme.accent;
}

// Codex `Aba`: the theme is built from the ChatGPT accent, then the accent
// layer replaces the message, selection and accent tints.
export function buildCodexThemeVariables(baseTheme: CodexTheme, variant: CodexThemeVariant): Record<string, string> {
  const name = chatgptAccentName(baseTheme, variant);
  const chatgpt = name ? chatgptLayer(name, variant) : null;
  const theme = chatgpt ? { ...baseTheme, accent: chatgpt.accent } : baseTheme;
  const variables = buildThemeVariables(theme, variant);
  return chatgpt ? {
    ...variables,
    "--app-color-text-unread-badge": name === "yellow" ? "var(--gray-fixed-1000)" : "var(--white)",
    "--color-background-composer-primary": chatgpt.submitBackground,
    "--color-text-composer-primary": chatgpt.submitText,
    "--color-background-user-message": chatgpt.userMessageBackground,
    "--color-text-user-message": chatgpt.userMessageText,
    "--color-background-text-selection": chatgpt.selection,
    "--color-background-attribution-highlight": chatgpt.attributionHighlight,
    "--app-color-background-accent": chatgpt.soft,
    "--app-color-background-accent-active": chatgpt.soft,
    "--app-color-background-accent-hover": chatgpt.soft,
    "--app-color-border-focus": chatgpt.accent,
    "--app-color-icon-accent": chatgpt.text,
    "--app-color-text-accent": chatgpt.text,
  } : variables;
}

function buildThemeVariables(theme: CodexTheme, variant: CodexThemeVariant): Record<string, string> {
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
    // Codex writes these from its font-size preference; 14px is the default.
    "--font-ui-size": "14px",
    "--font-code-size": "12px",
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
