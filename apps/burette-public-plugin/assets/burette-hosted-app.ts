import { App, type McpUiUpdateModelContextRequest } from "@modelcontextprotocol/ext-apps";
import { inject, pageview } from "@vercel/analytics";
import {
  createSceneContext,
  createSelectionContext,
  sanitizeViewerActions,
} from "../lib/hosted-context";
import { installHostedWorkspace, type HostedWorkspaceHome } from "./hosted-workspace";

type HostTheme = "light" | "dark";
type HostedEntrypoint = "global" | "thread" | "file";

declare global {
  interface Window {
    BuretteHostedAppBridge?: {
      ready: Promise<boolean>;
      setSource: (source: unknown) => void;
      updateSelection: (selection: unknown, documentId: string) => Promise<boolean>;
      updateScene: (report: unknown) => Promise<boolean>;
      callServerTool: (
        name: string,
        arguments_?: Record<string, unknown>,
      ) => ReturnType<App["callServerTool"]>;
      sanitizeViewerActions: (actions: unknown) => Record<string, unknown>[];
      theme?: HostTheme;
      backgrounds?: { light: string; dark: string };
      entrypoint?: HostedEntrypoint;
      home?: HostedWorkspaceHome;
    };
    __BURETTE_HOSTED_APP_QUEUE__?: Array<{ method: string; args: unknown[] }>;
    __BURETTE_HOSTED_APP_READY__?: (ready: boolean) => void;
    __BURETTE_HOSTED_ANALYTICS_ORIGIN__?: string;
    __BURETTE_HOSTED_KETCHER_WIDGET__?: boolean;
    openai?: {
      theme?: HostTheme;
      displayMode?: "inline" | "fullscreen" | "pip";
      surfaceBackgroundColor?: string;
      safeArea?: { insets?: { bottom?: number } };
      toolOutput?: unknown;
      toolResponseMetadata?: unknown;
    };
  }
}

function parseHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/u.test(trimmed)) return trimmed;
  const short = /^#([0-9a-f]{3})$/u.exec(trimmed);
  if (short) return `#${short[1].split("").map((part) => part + part).join("")}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/u.exec(trimmed);
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < 0.9)) return null;
  const channel = (raw: string) => Math.max(0, Math.min(255, Number(raw))).toString(16).padStart(2, "0");
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

const analyticsOrigin = window.__BURETTE_HOSTED_ANALYTICS_ORIGIN__;
if (analyticsOrigin?.startsWith("https://")) {
  inject({
    mode: "production",
    disableAutoTrack: true,
    scriptSrc: `${analyticsOrigin}/_vercel/insights/script.js`,
    viewEndpoint: `${analyticsOrigin}/api/analytics/view`,
  });
  pageview({ route: "/mcp/widget", path: "/mcp/widget" });
}

const app = new App(
  { name: "burette-molecular-viewer", version: "0.1.0" },
  {},
  { autoResize: true, strict: true },
);

let sourceDescriptor: unknown;
let connected = false;
let resolveConnected!: (ok: boolean) => void;
const appConnected = new Promise<boolean>((resolve) => {
  resolveConnected = resolve;
});
const ready = appConnected.then((initialized) => (
  initialized && app.getHostCapabilities()?.updateModelContext !== undefined
));

async function updateModelContext(params: McpUiUpdateModelContextRequest["params"]) {
  if (!(await ready) || !connected) return false;
  await app.updateModelContext(params);
  return true;
}

async function callServerTool(
  name: string,
  arguments_: Record<string, unknown> = {},
) {
  if (!(await appConnected) || !connected) {
    throw new Error("Burette Apps bridge is not ready for server tool calls.");
  }
  return app.callServerTool({ name, arguments: arguments_ });
}

const queuedCalls = Array.isArray(window.__BURETTE_HOSTED_APP_QUEUE__)
  ? window.__BURETTE_HOSTED_APP_QUEUE__.splice(0)
  : [];
// The viewer reports an empty selection on load; only clear the model context
// after something was selected, so hosts do not show an empty context card.
let selectionShared = false;
const initialBridge = window.BuretteHostedAppBridge;
const bridge: NonNullable<Window["BuretteHostedAppBridge"]> = {
  ...(initialBridge?.theme ? { theme: initialBridge.theme } : {}),
  ...(initialBridge?.backgrounds ? { backgrounds: { ...initialBridge.backgrounds } } : {}),
  ...(initialBridge?.entrypoint ? { entrypoint: initialBridge.entrypoint } : {}),
  setSource(source: unknown) {
    sourceDescriptor = source;
  },
  updateSelection(selection: unknown, documentId: string) {
    const context = createSelectionContext(selection, documentId, sourceDescriptor);
    const empty = context.structuredContent.burette.activeSelection === null;
    if (empty && !selectionShared) return Promise.resolve(false);
    selectionShared = !empty;
    return updateModelContext(context);
  },
  updateScene(report: unknown) {
    return updateModelContext(createSceneContext(report, sourceDescriptor));
  },
  callServerTool,
  sanitizeViewerActions,
  ready,
};
window.BuretteHostedAppBridge = bridge;

const hostBackgrounds: { light: string; dark: string } = {
  light: bridge.backgrounds?.light ?? "#ffffff",
  dark: bridge.backgrounds?.dark ?? "#181818",
};
const INLINE_EDITOR_HEIGHT_PX = 540;
let currentDisplayMode: "inline" | "fullscreen" | undefined;
let lastSentInlineHeight = 0;

function syncDisplayMode(nextMode?: unknown) {
  const resolved: "inline" | "fullscreen" | undefined =
    nextMode === "inline" || nextMode === "fullscreen"
      ? nextMode
      : currentDisplayMode;
  if (!resolved) return;
  currentDisplayMode = resolved;
  document.documentElement.dataset.displayMode = resolved;
  if (window.__BURETTE_HOSTED_KETCHER_WIDGET__ && resolved === "inline") {
    const height = INLINE_EDITOR_HEIGHT_PX;
    const filled = Math.max(height, window.innerHeight || 0);
    document.documentElement.style.height = `${filled}px`;
    document.body.style.height = `${filled}px`;
    if (connected && lastSentInlineHeight !== height) {
      lastSentInlineHeight = height;
      void app.sendSizeChanged({ height }).catch(() => { lastSentInlineHeight = 0; });
    }
  } else {
    lastSentInlineHeight = 0;
    document.documentElement.style.height = "";
    document.body.style.height = "";
  }
}

function applyHostAppearance(options: {
  theme?: unknown;
  surfaceColor?: unknown;
  bottomInset?: unknown;
}) {
  const nextTheme: HostTheme | undefined = options.theme === "light" || options.theme === "dark"
    ? options.theme
    : bridge.theme;
  const parsedSurface = parseHexColor(options.surfaceColor);
  let changed = false;
  if (nextTheme && bridge.theme !== nextTheme) {
    bridge.theme = nextTheme;
    document.documentElement.dataset.hostTheme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    changed = true;
  }
  const activeTheme = bridge.theme;
  if (parsedSurface && activeTheme && hostBackgrounds[activeTheme] !== parsedSurface) {
    hostBackgrounds[activeTheme] = parsedSurface;
    changed = true;
  }
  if (activeTheme && (parsedSurface || bridge.backgrounds)) {
    bridge.backgrounds = { ...hostBackgrounds };
    document.documentElement.style.setProperty("--burette-host-background", hostBackgrounds[activeTheme]);
  }
  const bottomInset = Number(options.bottomInset);
  if (Number.isFinite(bottomInset) && bottomInset >= 0) {
    document.documentElement.style.setProperty("--burette-hosted-bottom-inset", `${Math.round(bottomInset)}px`);
  }
  if (changed) window.dispatchEvent(new Event("burette-host-theme"));
}

function syncFromHostContext(context: ReturnType<App["getHostContext"]> | Record<string, unknown> | undefined) {
  if (!context || typeof context !== "object") return;
  const record = context as {
    theme?: unknown;
    displayMode?: unknown;
    styles?: { variables?: Record<string, unknown> };
    safeAreaInsets?: { bottom?: unknown };
  };
  syncDisplayMode(record.displayMode);
  applyHostAppearance({
    theme: record.theme,
    surfaceColor: record.styles?.variables?.["--color-background-primary"],
    bottomInset: record.safeAreaInsets?.bottom,
  });
}

app.onhostcontextchanged = (params) => {
  syncFromHostContext(params);
};

window.addEventListener("openai:set_globals", (event) => {
  const globals = (event as CustomEvent<{ globals?: Window["openai"] }>).detail?.globals;
  if (!globals) return;
  syncDisplayMode(globals.displayMode);
  applyHostAppearance({
    theme: globals.theme,
    surfaceColor: globals.surfaceBackgroundColor,
    bottomInset: globals.safeArea?.insets?.bottom,
  });
}, { passive: true });

syncDisplayMode(window.openai?.displayMode);
applyHostAppearance({
  theme: window.openai?.theme,
  surfaceColor: window.openai?.surfaceBackgroundColor,
  bottomInset: window.openai?.safeArea?.insets?.bottom,
});
window.addEventListener("resize", () => syncDisplayMode(currentDisplayMode), { passive: true });

installHostedWorkspace(app, (name, arguments_) => callServerTool(name, arguments_), (home, entrypoint) => {
  bridge.home = home;
  if (entrypoint) bridge.entrypoint = entrypoint;
  window.dispatchEvent(new Event("burette-hosted-home"));
});

app.connect().then(() => {
  connected = true;
  syncFromHostContext(app.getHostContext());
  resolveConnected(true);
}).catch((error) => {
  console.error("Burette Apps bridge initialization failed", error);
  resolveConnected(false);
});

for (const call of queuedCalls) {
  if (call.method === "setSource") bridge.setSource(call.args[0]);
  else if (call.method === "updateSelection") {
    void bridge.updateSelection(call.args[0], String(call.args[1] || "active-structure"));
  } else if (call.method === "updateScene") void bridge.updateScene(call.args[0]);
}
void appConnected.then((initialized) => window.__BURETTE_HOSTED_APP_READY__?.(initialized));
