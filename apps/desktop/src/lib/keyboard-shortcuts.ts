// Single registry of Burette keyboard shortcuts.
//
// Accelerators use the muda/Tauri syntax ("CmdOrCtrl+Shift+K"); an empty string
// means unassigned. User overrides live in ViewerPreferences.shortcutOverrides
// (command id -> accelerator) and only hold values that differ from the default.
//
// Scopes:
// - "menu": a native menu item with the same id (menu/build.rs). The desktop app
//   applies the accelerator to the menu at runtime; the browser runtime matches
//   it in the webview handler (hooks/use-keyboard-shortcuts.ts).
// - "webview": matched by the webview handler in every runtime.
// - "browser": matched by the webview handler in the browser runtime only.
// - "fixed": shown for reference and used for conflict checks, not editable.

export type ShortcutScope = "menu" | "webview" | "browser" | "fixed";

type ShortcutDefinitionShape = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope: ShortcutScope;
  readonly defaultAccelerator: string;
  /** Extra accelerators a fixed row occupies, for conflict checks. */
  readonly fixedAccelerators?: readonly string[];
  /** Display override for fixed rows whose keys are not one accelerator. */
  readonly displayKeys?: readonly string[];
  /** Allows a single key without Command, Control, or Option. */
  readonly allowsBareKey?: boolean;
};

const ONE_TO_NINE = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const SHORTCUT_DEFINITIONS = [
  { id: "view.command-palette", label: "Open command palette", description: "Search commands, settings, projects, and structures.", scope: "menu", defaultAccelerator: "CmdOrCtrl+P" },
  { id: "app.command-palette-quick", label: "Open command palette (quick key)", description: "Opens the command palette when no text field has focus.", scope: "webview", defaultAccelerator: "/", allowsBareKey: true },
  { id: "file.new-window", label: "New window", description: "Open another Burette workspace window.", scope: "menu", defaultAccelerator: "CmdOrCtrl+N" },
  { id: "file.new-tab", label: "New tab", description: "Open a launcher tab in the current window.", scope: "menu", defaultAccelerator: "CmdOrCtrl+T" },
  { id: "file.open", label: "Open structures", description: "Choose molecular structure files.", scope: "menu", defaultAccelerator: "CmdOrCtrl+O" },
  { id: "file.open-most-recent", label: "Open most recent structure", description: "Open the latest structure from recent files.", scope: "webview", defaultAccelerator: "CmdOrCtrl+Shift+O" },
  { id: "file.save", label: "Save", description: "Save the active text source or collection document (desktop app).", scope: "menu", defaultAccelerator: "CmdOrCtrl+S" },
  { id: "file.save-as", label: "Save as", description: "Save the active collection as a new file (desktop app).", scope: "menu", defaultAccelerator: "CmdOrCtrl+Shift+S" },
  { id: "edit.find", label: "Find", description: "Search the active collection grid, otherwise focus sidebar search (desktop app).", scope: "menu", defaultAccelerator: "CmdOrCtrl+F" },
  { id: "edit.undo", label: "Undo", description: "Undo in the active context: workspace history, or the collection grid when one is active.", scope: "fixed", defaultAccelerator: "CmdOrCtrl+Z" },
  { id: "edit.redo", label: "Redo", description: "Redo in the active context.", scope: "fixed", defaultAccelerator: "CmdOrCtrl+Shift+Z" },
  { id: "view.navigate-back", label: "Back", description: "Go to the previous page of the active tab.", scope: "menu", defaultAccelerator: "CmdOrCtrl+[" },
  { id: "view.navigate-forward", label: "Forward", description: "Go to the next page of the active tab.", scope: "menu", defaultAccelerator: "CmdOrCtrl+]" },
  { id: "view.toggle-sidebar", label: "Toggle sidebar", description: "Show or hide the project and structure browser.", scope: "menu", defaultAccelerator: "CmdOrCtrl+B" },
  { id: "view.toggle-bottom-panel", label: "Toggle bottom dock", description: "Show or hide the bottom workspace dock.", scope: "menu", defaultAccelerator: "CmdOrCtrl+J" },
  { id: "view.toggle-inspector", label: "Toggle right dock", description: "Show or hide the right workspace dock.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Alt+B" },
  { id: "view.zoom-in", label: "Zoom in", description: "Scale all window content up one step.", scope: "menu", defaultAccelerator: "CmdOrCtrl+=" },
  { id: "view.zoom-out", label: "Zoom out", description: "Scale all window content down one step.", scope: "menu", defaultAccelerator: "CmdOrCtrl+-" },
  { id: "view.zoom-actual", label: "Actual size", description: "Reset window content scaling to 100%.", scope: "menu", defaultAccelerator: "CmdOrCtrl+0" },
  { id: "view.toggle-sidebar-browser", label: "Toggle sidebar (browser)", description: "Show or hide the sidebar in the browser runtime.", scope: "browser", defaultAccelerator: "CmdOrCtrl+\\" },
  { id: "help.keyboard-shortcuts", label: "Show keyboard shortcuts", description: "Open the keyboard shortcuts settings.", scope: "menu", defaultAccelerator: "CmdOrCtrl+/" },
  { id: "settings.open", label: "Open settings", description: "Open the settings workspace.", scope: "menu", defaultAccelerator: "CmdOrCtrl+," },
  { id: "file.close-tab", label: "Close active tab", description: "Close the selected tab.", scope: "menu", defaultAccelerator: "CmdOrCtrl+W" },
  { id: "file.close-other-tabs", label: "Close other tabs", description: "Close every tab except the selected one.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Alt+W" },
  { id: "file.reopen-closed-tab", label: "Reopen closed tab", description: "Reopen the most recently closed tab.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Shift+T" },
  { id: "file.close-window", label: "Close active window", description: "Close the frontmost Burette window.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Shift+W" },
  { id: "app.quit", label: "Quit Burette", description: "Quit after the exit preflight completes (desktop app).", scope: "menu", defaultAccelerator: "CmdOrCtrl+Q" },
  { id: "window.next-tab", label: "Select next tab", description: "Move to the next tab in the current window.", scope: "menu", defaultAccelerator: "Ctrl+Tab" },
  { id: "window.previous-tab", label: "Select previous tab", description: "Move to the previous tab in the current window.", scope: "menu", defaultAccelerator: "Ctrl+Shift+Tab" },
  { id: "file.reveal-active", label: "Reveal in Finder", description: "Show the active structure file in Finder.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Shift+R" },
  { id: "file.copy-active-path", label: "Copy active path", description: "Copy the active structure file path.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Shift+C" },
  { id: "file.show-active-metadata", label: "Get Info", description: "Show renderer, format, path, and file size for the active structure.", scope: "menu", defaultAccelerator: "CmdOrCtrl+I" },
  { id: "file.export-preview-png", label: "Export preview as PNG", description: "Save the active external preview as a PNG file.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Shift+E" },
  { id: "file.export-preview-svg", label: "Export preview as SVG", description: "Save the active external preview as an SVG file.", scope: "menu", defaultAccelerator: "CmdOrCtrl+Alt+E" },
  {
    id: "view.jump-to-structure",
    label: "Jump to structure",
    description: "Open the numbered sidebar structure, or the matching tab when the sidebar is hidden. Hold ⌘ to show the numbers.",
    scope: "fixed",
    defaultAccelerator: "CmdOrCtrl+1",
    fixedAccelerators: ONE_TO_NINE.map((digit) => `CmdOrCtrl+${digit}`),
    displayKeys: ["⌘1", "⌘2", "…", "⌘9"],
  },
] as const satisfies readonly ShortcutDefinitionShape[];

export type ShortcutDefinition = (typeof SHORTCUT_DEFINITIONS)[number] & ShortcutDefinitionShape;
export type ShortcutId = ShortcutDefinition["id"];
export type ShortcutOverrides = Record<string, string>;

const definitionsById = new Map<string, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function shortcutDefinition(id: string): ShortcutDefinition | undefined {
  return definitionsById.get(id);
}

export function isEditableShortcut(definition: ShortcutDefinition) {
  return definition.scope !== "fixed";
}

export function resolveShortcutAccelerator(id: ShortcutId, overrides: ShortcutOverrides): string {
  const definition = definitionsById.get(id);
  if (!definition) return "";
  const override = overrides[id];
  if (isEditableShortcut(definition) && typeof override === "string") return override;
  return definition.defaultAccelerator;
}

export function resolveShortcutBindings(overrides: ShortcutOverrides): Record<ShortcutId, string> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.id, resolveShortcutAccelerator(definition.id, overrides)]),
  ) as Record<ShortcutId, string>;
}

/** Resolved accelerators for every customizable native menu item, defaults included. */
export function nativeMenuAccelerators(overrides: ShortcutOverrides): Record<string, string> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS
      .filter((definition) => definition.scope === "menu")
      .map((definition) => [definition.id, resolveShortcutAccelerator(definition.id, overrides)]),
  );
}

const MAX_OVERRIDE_ENTRIES = SHORTCUT_DEFINITIONS.length;

/** Keeps only editable ids with parseable accelerators that differ from the default. */
export function normalizeShortcutOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: ShortcutOverrides = {};
  for (const [id, accelerator] of Object.entries(value).slice(0, MAX_OVERRIDE_ENTRIES * 2)) {
    const definition = definitionsById.get(id);
    if (!definition || !isEditableShortcut(definition) || typeof accelerator !== "string") continue;
    if (accelerator === "") {
      if (definition.defaultAccelerator) normalized[id] = "";
      continue;
    }
    const canonical = canonicalAccelerator(accelerator);
    if (canonical === null || !isAssignableAccelerator(definition, accelerator)) continue;
    if (canonical === canonicalAccelerator(definition.defaultAccelerator)) continue;
    normalized[id] = accelerator.trim();
  }
  return normalized;
}

/** Returns overrides with `id` set to `accelerator`, dropping the entry when it equals the default. */
export function withShortcutOverride(overrides: ShortcutOverrides, id: ShortcutId, accelerator: string): ShortcutOverrides {
  return normalizeShortcutOverrides({ ...overrides, [id]: accelerator });
}

export function withoutShortcutOverride(overrides: ShortcutOverrides, id: ShortcutId): ShortcutOverrides {
  const next = { ...overrides };
  delete next[id];
  return next;
}

/** The first other shortcut already bound to `accelerator`, including fixed rows. */
export function findShortcutConflict(id: ShortcutId, accelerator: string, overrides: ShortcutOverrides): ShortcutDefinition | null {
  const target = canonicalAccelerator(accelerator);
  if (!target) return null;
  for (const definition of SHORTCUT_DEFINITIONS as readonly ShortcutDefinition[]) {
    if (definition.id === id) continue;
    const occupied = definition.fixedAccelerators ?? [resolveShortcutAccelerator(definition.id, overrides)];
    if (occupied.some((candidate) => canonicalAccelerator(candidate) === target)) return definition;
  }
  return null;
}

/** Menu accelerators need Command, Control, or Option, or a function key, so typing keeps working. */
export function isAssignableAccelerator(definition: ShortcutDefinition, accelerator: string) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  if (definition.allowsBareKey) return true;
  return parsed.meta || parsed.ctrl || parsed.alt || /^F\d{1,2}$/u.test(parsed.key);
}

// ---------------------------------------------------------------------------
// Accelerator parsing, matching, and display.

type ParsedAccelerator = { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string };

export function isMacPlatform() {
  if (typeof navigator === "undefined") return true;
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform ?? "") || /Mac OS X/u.test(navigator.userAgent ?? "");
}

const KEY_ALIASES: Record<string, string> = {
  ESC: "Escape", ESCAPE: "Escape", SPACE: "Space", TAB: "Tab", ENTER: "Enter", RETURN: "Enter",
  BACKSPACE: "Backspace", DELETE: "Delete", HOME: "Home", END: "End", PAGEUP: "PageUp", PAGEDOWN: "PageDown",
  UP: "Up", ARROWUP: "Up", DOWN: "Down", ARROWDOWN: "Down", LEFT: "Left", ARROWLEFT: "Left", RIGHT: "Right", ARROWRIGHT: "Right",
  EQUAL: "=", MINUS: "-", COMMA: ",", PERIOD: ".", SLASH: "/", BACKSLASH: "\\", SEMICOLON: ";", QUOTE: "'",
  BACKQUOTE: "`", BRACKETLEFT: "[", BRACKETRIGHT: "]",
};
const SYMBOL_KEYS = new Set(["=", "-", ",", ".", "/", "\\", ";", "'", "`", "[", "]"]);

function canonicalKey(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (SYMBOL_KEYS.has(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (/^[A-Z0-9]$/u.test(upper)) return upper;
  if (/^KEY[A-Z]$/u.test(upper)) return upper.slice(3);
  if (/^DIGIT[0-9]$/u.test(upper)) return upper.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/u.test(upper)) return upper;
  return KEY_ALIASES[upper] ?? null;
}

function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const trimmed = accelerator.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split("+");
  const keyToken = tokens.pop();
  if (keyToken === undefined) return null;
  const key = canonicalKey(keyToken);
  if (!key) return null;
  const mac = isMacPlatform();
  const parsed: ParsedAccelerator = { meta: false, ctrl: false, alt: false, shift: false, key };
  for (const token of tokens) {
    switch (token.trim().toUpperCase()) {
      case "CMDORCTRL": case "COMMANDORCONTROL": case "COMMANDORCTRL": case "CMDORCONTROL":
        if (mac) parsed.meta = true; else parsed.ctrl = true;
        break;
      case "CMD": case "COMMAND": case "SUPER": case "META": parsed.meta = true; break;
      case "CTRL": case "CONTROL": parsed.ctrl = true; break;
      case "ALT": case "OPTION": parsed.alt = true; break;
      case "SHIFT": parsed.shift = true; break;
      default: return null;
    }
  }
  return parsed;
}

/** Platform-resolved comparison key, or null when the accelerator does not parse. */
function canonicalAccelerator(accelerator: string): string | null {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return null;
  return [parsed.ctrl && "Ctrl", parsed.alt && "Alt", parsed.shift && "Shift", parsed.meta && "Meta", parsed.key].filter(Boolean).join("+");
}

const CODE_KEYS: Record<string, string> = {
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Backquote: "`", Space: "Space", Tab: "Tab", Enter: "Enter", NumpadEnter: "Enter",
  Backspace: "Backspace", Delete: "Delete", Escape: "Escape", Home: "Home", End: "End", PageUp: "PageUp",
  PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
};

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** Physical key token (layout independent where possible), or null for bare modifiers. */
function eventKey(event: KeyEventLike): string | null {
  if (["Meta", "Control", "Alt", "AltGraph", "Shift", "CapsLock", "Fn", "OS"].includes(event.key)) return null;
  const code = event.code ?? "";
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/u.test(code)) return code;
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  return event.key ? canonicalKey(event.key === " " ? "Space" : event.key) : null;
}

/** Records a keydown as an accelerator string, or null while only modifiers are held. */
export function acceleratorFromEvent(event: KeyEventLike): string | null {
  const key = eventKey(event);
  if (!key) return null;
  const mac = isMacPlatform();
  const primary = mac ? event.metaKey : event.ctrlKey;
  const parts: string[] = [];
  if (primary) parts.push("CmdOrCtrl");
  if (mac ? event.ctrlKey : event.metaKey) parts.push(mac ? "Ctrl" : "Super");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function matchesAccelerator(event: KeyEventLike, accelerator: string): boolean {
  if (!accelerator) return false;
  const parsed = parseAccelerator(accelerator);
  const key = eventKey(event);
  return Boolean(parsed && key
    && parsed.key === key
    && parsed.meta === event.metaKey
    && parsed.ctrl === event.ctrlKey
    && parsed.alt === event.altKey
    && parsed.shift === event.shiftKey);
}

const MAC_KEY_GLYPHS: Record<string, string> = {
  Tab: "⇥", Enter: "↩", Backspace: "⌫", Delete: "⌦", Escape: "⎋", Space: "Space",
  Up: "↑", Down: "↓", Left: "←", Right: "→", PageUp: "⇞", PageDown: "⇟", Home: "↖", End: "↘",
};

/** Key-cap label: "⇧⌘K" on macOS, "Ctrl+Shift+K" elsewhere. */
export function formatAccelerator(accelerator: string): string {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return accelerator;
  if (isMacPlatform()) {
    return `${parsed.ctrl ? "⌃" : ""}${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${parsed.meta ? "⌘" : ""}${MAC_KEY_GLYPHS[parsed.key] ?? parsed.key}`;
  }
  return [parsed.ctrl && "Ctrl", parsed.meta && "Win", parsed.alt && "Alt", parsed.shift && "Shift", parsed.key].filter(Boolean).join("+");
}

/** Modifier glyphs currently held, for the recorder's live prompt. */
export function formatHeldModifiers(event: KeyEventLike): string {
  if (isMacPlatform()) {
    return `${event.ctrlKey ? "⌃" : ""}${event.altKey ? "⌥" : ""}${event.shiftKey ? "⇧" : ""}${event.metaKey ? "⌘" : ""}`;
  }
  return [event.ctrlKey && "Ctrl", event.metaKey && "Win", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean).map((part) => `${part}+`).join("");
}

export function shortcutDisplayKeys(definition: ShortcutDefinition, overrides: ShortcutOverrides): string[] {
  if (definition.displayKeys) return [...definition.displayKeys];
  const accelerator = resolveShortcutAccelerator(definition.id, overrides);
  return accelerator ? [formatAccelerator(accelerator)] : [];
}
