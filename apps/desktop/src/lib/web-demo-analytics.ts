const WEB_DEMO_ENABLED = import.meta.env.VITE_BURRETE_WEB_DEMO === "1";
const ANALYTICS_ROUTE = "/web-demo";
const ANALYTICS_PATH = "/web-demo/index.html";
const SAFE_EXTENSIONS = new Set([
  "pdb", "ent", "pdbqt", "pqr", "cif", "mmcif", "mcif", "sdf", "sd", "mol",
  "mol2", "xyz", "extxyz", "gro", "mae", "maegz", "cms", "dcd", "xtc", "trr",
  "nc", "csv", "tsv", "mgf", "msp", "mzml", "mzxml", "txt", "md", "json",
]);
const installedDocuments = new WeakSet<Document>();
const installedWindows = new WeakSet<Window>();
const searchTimers = new WeakMap<HTMLInputElement, number>();
let initialized = false;
let vercelTrack: typeof import("@vercel/analytics").track | null = null;
const pendingEvents: Array<{ name: string; properties: AnalyticsProperties }> = [];

type AnalyticsProperty = string | number | boolean | null;
type AnalyticsProperties = Record<string, AnalyticsProperty>;

export async function initializeWebDemoAnalytics() {
  if (!canSendAnalytics() || initialized) return;
  const canonicalUrl = `${window.location.origin}${ANALYTICS_PATH}`;
  const [analytics, speedInsights] = await Promise.all([
    import("@vercel/analytics"),
    import("@vercel/speed-insights"),
  ]);

  analytics.inject({
    mode: "production",
    disableAutoTrack: true,
    beforeSend: (event) => ({ ...event, url: canonicalUrl }),
  });
  speedInsights.injectSpeedInsights({
    route: ANALYTICS_ROUTE,
    beforeSend: (event) => ({ ...event, url: canonicalUrl, route: ANALYTICS_ROUTE }),
  });
  analytics.pageview({ route: ANALYTICS_ROUTE, path: ANALYTICS_PATH });
  vercelTrack = analytics.track;
  initialized = true;
  for (const event of pendingEvents.splice(0)) vercelTrack(event.name, event.properties);

  sendEvent("demo_session_started", {
    mode: webDemoMode(),
    viewport: viewportCategory(window.innerWidth),
  });
  installDocumentTelemetry(document, "workspace");
  installWindowErrorTelemetry(window, "workspace");
  installIframeTelemetry(document);
  installEngagementMilestones();
}

export function trackWebDemoHandledError(error: unknown, prefix?: string) {
  if (!WEB_DEMO_ENABLED) return;
  sendEvent("app_error", {
    category: classifyWebDemoError(error),
    operation: classifyWebDemoOperation(prefix),
  });
}

export function trackWebDemoLocalFiles(files: File[], directory: boolean) {
  if (!WEB_DEMO_ENABLED || files.length === 0) return;
  sendEvent("local_files_selected", {
    input: directory ? "folder" : "files",
    formats: formatSummary(files.map((file) => file.name)),
  });
}

export function trackWebDemoScreenView(kind: string | undefined, renderer?: string | null) {
  if (!WEB_DEMO_ENABLED) return;
  sendEvent("screen_viewed", {
    screen: safeScreenKind(kind),
    renderer: safeRenderer(renderer),
  });
}

export function trackWebDemoStructureView(extension: string | undefined, renderer?: string | null) {
  if (!WEB_DEMO_ENABLED) return;
  sendEvent("structure_viewed", {
    format: safeExtension(extension),
    renderer: safeRenderer(renderer),
  });
}

export function classifyWebDemoError(error: unknown) {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error ?? "unknown");
  const normalized = message.toLowerCase();
  if (/abort|cancel/u.test(normalized)) return "cancelled";
  if (/timeout|timed out/u.test(normalized)) return "timeout";
  if (/network|fetch|load failed|failed to load|offline|connection/u.test(normalized)) return "network";
  if (/permission|denied|not allowed|unauthorized|forbidden/u.test(normalized)) return "permission";
  if (/unsupported|not supported|unknown format|unrecognized/u.test(normalized)) return "unsupported_format";
  if (/parse|syntax|invalid (?:file|data|structure)|malformed/u.test(normalized)) return "parse";
  if (/render|webgl|shader|canvas/u.test(normalized)) return "render";
  if (/wasm|worker/u.test(normalized)) return "runtime_asset";
  if (/quota|storage/u.test(normalized)) return "storage";
  return error instanceof TypeError ? "type_error" : "unknown";
}

export function classifyWebDemoOperation(prefix?: string) {
  const normalized = prefix?.toLowerCase() ?? "";
  if (/fetch|rcsb|pdb/u.test(normalized)) return "fetch_structure";
  if (/render|viewer|molstar|xyzrender/u.test(normalized)) return "render_structure";
  if (/open|preview/u.test(normalized)) return "open_structure";
  if (/drop|drag|paste/u.test(normalized)) return "input";
  if (/ketcher|sketch|conformer/u.test(normalized)) return "chemistry_editor";
  if (/descriptor/u.test(normalized)) return "descriptors";
  if (/dock/u.test(normalized)) return "docking";
  if (/export|save/u.test(normalized)) return "export";
  if (/runtime|install|xtb|crest/u.test(normalized)) return "runtime";
  if (/command/u.test(normalized)) return "command";
  return "application";
}

export function safeCommandId(value: string | null) {
  if (!value) return "unknown";
  if (value.startsWith("fetch-pdb-")) return "fetch_pdb";
  if (value.startsWith("draw-smiles-")) return "draw_smiles";
  if (value.startsWith("fetch-structure-url:")) return "fetch_structure_url";
  const known = new Set([
    "open-structure", "open-clipboard", "fetch-structure-url", "new-window",
    "open-recent", "search-projects", "open-settings", "open-ketcher",
    "open-fep-network", "open-agent-integration", "toggle-sidebar", "close-active",
    "close-all", "clear-recent", "clear-cache", "show-active-metadata",
    "export-preview-png", "export-preview-svg", "runtime-doctor", "check-updates",
    "renderer-auto", "renderer-molstar", "renderer-xyzrender",
  ]);
  return known.has(value) ? value.replaceAll("-", "_") : "open_project_structure";
}

function canSendAnalytics() {
  return WEB_DEMO_ENABLED
    && typeof window !== "undefined"
    && window.location.protocol === "https:"
    && window.location.pathname.startsWith("/web-demo/");
}

function sendEvent(name: string, properties: AnalyticsProperties) {
  if (!canSendAnalytics()) return;
  if (!initialized || !vercelTrack) {
    if (pendingEvents.length < 32) pendingEvents.push({ name, properties });
    return;
  }
  vercelTrack(name, properties);
}

function installDocumentTelemetry(targetDocument: Document, fallbackSurface: string) {
  if (installedDocuments.has(targetDocument)) return;
  installedDocuments.add(targetDocument);
  targetDocument.addEventListener("click", (event) => trackClick(event, fallbackSurface), true);
  targetDocument.addEventListener("change", trackSettingChange, true);
  targetDocument.addEventListener("input", trackSearchInput, true);
  targetDocument.addEventListener("drop", (event) => trackInputMethod(event, "drop", fallbackSurface), true);
  targetDocument.addEventListener("paste", (event) => trackInputMethod(event, "paste", fallbackSurface), true);
  targetDocument.addEventListener("keydown", (event) => trackShortcut(event, fallbackSurface), true);
}

function installIframeTelemetry(targetDocument: Document) {
  const connect = (iframe: HTMLIFrameElement) => {
    try {
      const frameDocument = iframe.contentDocument;
      const frameWindow = iframe.contentWindow;
      if (!frameDocument || !frameWindow) return;
      installDocumentTelemetry(frameDocument, "viewer");
      installWindowErrorTelemetry(frameWindow, "viewer");
    } catch {
      sendEvent("app_error", { category: "iframe_access", operation: "render_structure" });
    }
  };
  for (const iframe of targetDocument.querySelectorAll("iframe")) connect(iframe);
  targetDocument.addEventListener("load", (event) => {
    if (event.target instanceof HTMLIFrameElement) connect(event.target);
  }, true);
}

function installWindowErrorTelemetry(targetWindow: Window, surface: string) {
  if (installedWindows.has(targetWindow)) return;
  installedWindows.add(targetWindow);
  targetWindow.addEventListener("error", (event) => {
    const target = eventElement(event.target);
    if (target && target !== targetWindow.document.documentElement) {
      sendEvent("resource_error", {
        resource: safeResourceType(target),
        surface,
      });
      return;
    }
    sendEvent("app_error", {
      category: classifyWebDemoError(event.error ?? event.message),
      operation: surface === "viewer" ? "render_structure" : "application",
    });
  }, true);
  targetWindow.addEventListener("unhandledrejection", (event) => {
    sendEvent("app_error", {
      category: classifyWebDemoError(event.reason),
      operation: surface === "viewer" ? "render_structure" : "application",
    });
  });
}

function trackClick(event: MouseEvent, fallbackSurface: string) {
  const target = eventElement(event.target);
  const element = target
    ? target.closest<HTMLElement>("button, a, input, select, [role='button'], [role='tab'], [role='menuitem'], [cmdk-item], [data-sidebar-structure-path]")
    : null;
  if (!element || element.matches(":disabled, [aria-disabled='true']")) return;
  const surface = detectSurface(element, fallbackSurface);

  const structure = element.closest<HTMLElement>("[data-sidebar-structure-path]");
  if (structure) {
    sendEvent("structure_open_requested", {
      format: safeExtension(structure.dataset.sidebarStructurePath),
      renderer: safeRenderer(structure.dataset.sidebarStructureRenderer),
    });
    return;
  }

  const command = element.closest<HTMLElement>("[cmdk-item]");
  if (command) {
    sendEvent("command_run", {
      command: safeCommandId(command.getAttribute("data-value")),
      source: "palette",
    });
    return;
  }

  sendEvent("ui_interaction", {
    control: classifyControl(element, surface),
    surface,
  });
}

function trackSettingChange(event: Event) {
  const target = eventElement(event.target);
  const element = target?.matches("input, select") ? target as HTMLInputElement | HTMLSelectElement : null;
  const setting = element?.closest<HTMLElement>(".settings-control");
  if (!element || !setting) return;
  const label = setting.querySelector<HTMLElement>(".settings-control-label")?.textContent ?? "setting";
  sendEvent("setting_changed", {
    setting: safeSlug(label, "setting"),
    value: safeSettingValue(element),
  });
}

function trackSearchInput(event: Event) {
  const target = eventElement(event.target);
  const input = target?.matches("input") ? target as HTMLInputElement : null;
  if (!input || input.type !== "search") return;
  const existing = searchTimers.get(input);
  if (existing) window.clearTimeout(existing);
  searchTimers.set(input, window.setTimeout(() => {
    sendEvent("search_used", {
      surface: input.matches("[data-sidebar-search]") ? "sidebar" : "command_palette",
      query_length: lengthBucket(input.value.length),
    });
  }, 800));
}

function trackInputMethod(event: Event, method: string, fallbackSurface: string) {
  const element = eventElement(event.target);
  sendEvent("input_used", {
    method,
    surface: element ? detectSurface(element, fallbackSurface) : fallbackSurface,
  });
}

function trackShortcut(event: KeyboardEvent, fallbackSurface: string) {
  const shortcut = safeShortcut(event);
  if (!shortcut) return;
  const element = eventElement(event.target);
  sendEvent("shortcut_used", {
    shortcut,
    surface: element ? detectSurface(element, fallbackSurface) : fallbackSurface,
  });
}

function classifyControl(element: HTMLElement, surface: string) {
  const explicitControl = element.closest<HTMLElement>("[data-analytics-control]")?.dataset.analyticsControl;
  if (explicitControl) return safeSlug(explicitControl, "control");
  const testId = element.closest<HTMLElement>("[data-testid]")?.dataset.testid;
  if (testId && surface === "ketcher") return `ketcher_${safeSlug(testId, "control")}`;
  if (element.closest(".welcome-primary")) return "open_structure";
  if (element.closest(".new-tab-actions")) return safeSlug(element.textContent ?? "welcome_action", "welcome_action");
  if (element.closest(".tab-close")) return "close_tab";
  if (element.closest(".tab")) return "select_tab";
  if (element.closest(".dock-tab")) return `select_${safeSlug(element.getAttribute("title") ?? "dock", "dock")}`;
  if (element.closest(".settings-toggle")) return "toggle_setting";
  if (element.closest(".settings-action-button")) return "settings_action";
  if (element.closest(".sidebar-section-title-button")) return "toggle_sidebar_section";
  if (element.closest(".project-group-row")) return "toggle_project";
  const label = (element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "").toLowerCase();
  const exact = CONTROL_LABELS.get(label);
  if (exact) return exact;
  if (/^(close|dismiss|cancel)\b/u.test(label)) return "close_item";
  if (/^(pin|unpin)\b/u.test(label)) return "toggle_pin";
  if (/^(expand|collapse|show|hide)\b/u.test(label)) return "toggle_view";
  const viewerKeyword = VIEWER_CONTROL_KEYWORDS.find((keyword) => label.includes(keyword));
  if (viewerKeyword && surface === "viewer") return `viewer_${viewerKeyword.replaceAll(" ", "_")}`;
  if (element.tagName === "SELECT") return "select_option";
  if (element.tagName === "INPUT") return (element as HTMLInputElement).type === "search" ? "focus_search" : "input";
  return surface === "viewer" ? "viewer_control" : "button";
}

const CONTROL_LABELS = new Map([
  ["hide sidebar", "toggle_sidebar"], ["show sidebar", "toggle_sidebar"],
  ["hide bottom dock", "toggle_bottom_dock"], ["show bottom dock", "toggle_bottom_dock"],
  ["hide right dock", "toggle_right_dock"], ["show right dock", "toggle_right_dock"],
  ["open ketcher", "open_ketcher"], ["open settings", "open_settings"],
  ["new tab", "new_tab"], ["back", "navigate_back"], ["forward", "navigate_forward"],
  ["project options", "project_options"], ["file actions", "file_actions"],
  ["generate 3d conformer", "generate_3d"], ["open sketch as 2d grid", "open_sketch_grid"],
  ["open sketch in molstar", "open_sketch_molstar"], ["open sketch in xyzrender", "open_sketch_xyzrender"],
]);

const VIEWER_CONTROL_KEYWORDS = [
  "camera", "representation", "selection", "trajectory", "play", "pause", "next",
  "previous", "reset", "zoom", "fullscreen", "screenshot", "background", "style",
];

function detectSurface(element: Element, fallback: string) {
  if (element.closest("[cmdk-dialog]")) return "command_palette";
  if (element.closest(".settings-page, .settings-panel")) return "settings";
  if (element.closest(".ketcher-page")) return "ketcher";
  if (element.closest(".sidebar-shell")) return "sidebar";
  const dock = element.closest<HTMLElement>(".dock-panel");
  if (dock) return `${dock.dataset.area ?? "unknown"}_dock`;
  if (element.closest(".topbar, .tab-strip")) return "tabs";
  if (element.closest(".new-tab-page")) return "welcome";
  if (element.closest(".molecule-stage, .viewer-frame")) return "viewer";
  return fallback;
}

function installEngagementMilestones() {
  for (const seconds of [10, 30, 60, 180, 600]) {
    window.setTimeout(() => {
      sendEvent("engagement_milestone", {
        seconds,
        visibility: document.visibilityState === "visible" ? "visible" : "background",
      });
    }, seconds * 1000);
  }
}

function webDemoMode() {
  return new URLSearchParams(window.location.search).get("embed") === "hero" ? "hero" : "full";
}

function viewportCategory(width: number) {
  if (width < 768) return "mobile";
  if (width < 1100) return "tablet";
  return "desktop";
}

function safeScreenKind(kind?: string) {
  const allowed = new Set(["file", "text-file", "new-tab", "settings", "ketcher", "fep-network", "fep-setup", "pose-review"]);
  return kind && allowed.has(kind) ? kind.replaceAll("-", "_") : "other";
}

function safeRenderer(renderer?: string | null) {
  const allowed = new Set(["molstar", "xyzrender-external", "grid2d", "spectrum", "not-renderable"]);
  return renderer && allowed.has(renderer) ? renderer.replaceAll("-", "_") : "none";
}

function safeExtension(value?: string | null) {
  const lastSegment = value?.split(/[\\/]/u).at(-1) ?? "";
  const extension = lastSegment.includes(".") ? lastSegment.split(".").at(-1)?.toLowerCase() ?? "" : lastSegment.toLowerCase();
  return SAFE_EXTENSIONS.has(extension) ? extension : "unknown";
}

function formatSummary(paths: string[]) {
  const formats = Array.from(new Set(paths.map(safeExtension))).sort();
  return formats.slice(0, 4).join("+") || "unknown";
}

function safeSettingValue(element: HTMLInputElement | HTMLSelectElement) {
  if (element.tagName === "SELECT" && /^[a-z0-9_.-]{1,32}$/iu.test(element.value)) {
    return element.value.toLowerCase();
  }
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (input.type === "checkbox" || input.getAttribute("role") === "switch") return input.checked ? "on" : "off";
  }
  return "changed";
}

function safeResourceType(target: Element) {
  const tag = target.tagName.toLowerCase();
  return ["script", "link", "img", "iframe", "video", "audio", "source"].includes(tag) ? tag : "other";
}

function eventElement(target: EventTarget | null) {
  return target && "nodeType" in target && target.nodeType === 1 ? target as Element : null;
}

function safeShortcut(event: KeyboardEvent) {
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier && event.key !== "/") return null;
  const key = event.key.toLowerCase();
  const allowed = new Set(["p", "o", ",", "j", "b", "w", "k", "/"]);
  if (!allowed.has(key)) return null;
  return modifier ? `mod_${key === "," ? "comma" : key === "/" ? "slash" : key}` : "slash";
}

function safeSlug(value: string, fallback: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 64);
  return slug || fallback;
}

function lengthBucket(length: number) {
  if (length === 0) return "empty";
  if (length <= 4) return "1_4";
  if (length <= 12) return "5_12";
  if (length <= 32) return "13_32";
  return "33_plus";
}
