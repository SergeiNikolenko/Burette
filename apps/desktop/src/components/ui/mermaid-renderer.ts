const MERMAID_MAX_LINES = 160;
const MERMAID_MAX_SOURCE_LENGTH = 12_000;
const MERMAID_CACHE_LIMIT = 64;
const MERMAID_SCOPED_CACHE_LIMIT = 128;
const MMDR_VERSION = "0.2.2";
const MMDR_WASM_URL = "/vendor/mmdr/typst_mmdr.wasm";
const MMDR_BASE_THEME = "modern";
const MMDR_LAYOUT = "";

const MMDR_THEME = {
  background: "transparent",
  cluster_bkg: "transparent",
  cluster_border: "var(--mmdr-border)",
  edge_label_background: "transparent",
  font_family: "Inter, ui-sans-serif, system-ui, sans-serif",
  font_size: 16,
  line_color: "var(--mmdr-line)",
  primary_border_color: "var(--mmdr-border)",
  primary_color: "var(--mmdr-node-fill)",
  primary_text_color: "var(--mmdr-text)",
  secondary_color: "var(--mmdr-node-fill)",
  tertiary_color: "var(--mmdr-node-fill)",
} as const;
const MMDR_THEME_JSON = JSON.stringify(MMDR_THEME);

const MERMAID_CONFIG = {
  flowchart: {
    htmlLabels: false,
    useMaxWidth: true,
  },
  securityLevel: "strict",
  sequence: {
    useMaxWidth: true,
  },
  startOnLoad: false,
  suppressErrorRendering: true,
  theme: "base",
  themeVariables: {
    background: "transparent",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    lineColor: "#64748b",
    primaryBorderColor: "#94a3b8",
    primaryColor: "#f8fafc",
    primaryTextColor: "#0f172a",
    secondaryColor: "#ecfeff",
    tertiaryColor: "#f0fdf4",
  },
} as const;

const DIAGRAM_CACHE_CONFIG_KEY = JSON.stringify({
  mermaid: MERMAID_CONFIG,
  mmdr: {
    baseTheme: MMDR_BASE_THEME,
    theme: MMDR_THEME,
    version: MMDR_VERSION,
  },
});
const MERMAID_CACHE_CONFIG_KEY = JSON.stringify(MERMAID_CONFIG);

export const MERMAID_VIEWER_STYLES = `
[data-pretext-mermaid-svg] {
  --mmdr-border: var(--border);
  --mmdr-line: var(--muted-foreground);
  --mmdr-node-fill: color-mix(in srgb, var(--background) 88%, var(--foreground) 12%);
  --mmdr-text: var(--foreground);
}
[data-pretext-mermaid-svg] svg {
  color: var(--foreground);
  display: block;
  height: auto;
  margin-inline: auto;
  max-width: 100%;
}
[data-pretext-mermaid-svg] rect.background {
  fill: transparent;
  stroke: none;
}
[data-pretext-mermaid-svg] .node rect,
[data-pretext-mermaid-svg] .node polygon,
[data-pretext-mermaid-svg] .node circle,
[data-pretext-mermaid-svg] .node ellipse,
[data-pretext-mermaid-svg] .node path,
[data-pretext-mermaid-svg] .basic.label-container,
[data-pretext-mermaid-svg] .label-container,
[data-pretext-mermaid-svg] .actor,
[data-pretext-mermaid-svg] .entityBox,
[data-pretext-mermaid-svg] .state,
[data-pretext-mermaid-svg] .classGroup rect,
[data-pretext-mermaid-svg] .requirement,
[data-pretext-mermaid-svg] .requirementBox,
[data-pretext-mermaid-svg] .element,
[data-pretext-mermaid-svg] .cluster rect,
[data-pretext-mermaid-svg] .note,
[data-pretext-mermaid-svg] .task {
  fill: color-mix(in srgb, var(--background) 88%, var(--foreground) 12%);
  stroke: var(--border);
  stroke-width: 1px;
}
[data-pretext-mermaid-svg] .cluster rect,
[data-pretext-mermaid-svg] .section,
[data-pretext-mermaid-svg] .grid .tick line {
  fill: color-mix(in srgb, var(--background) 94%, var(--foreground) 6%);
  stroke: var(--border);
}
[data-pretext-mermaid-svg] text,
[data-pretext-mermaid-svg] tspan,
[data-pretext-mermaid-svg] .label,
[data-pretext-mermaid-svg] .label text,
[data-pretext-mermaid-svg] .nodeLabel,
[data-pretext-mermaid-svg] .edgeLabel,
[data-pretext-mermaid-svg] .actor,
[data-pretext-mermaid-svg] .messageText,
[data-pretext-mermaid-svg] .noteText,
[data-pretext-mermaid-svg] .taskText,
[data-pretext-mermaid-svg] .sectionTitle,
[data-pretext-mermaid-svg] .titleText {
  color: var(--foreground);
  fill: var(--foreground);
}
[data-pretext-mermaid-svg] .edgePath path,
[data-pretext-mermaid-svg] .flowchart-link,
[data-pretext-mermaid-svg] .messageLine0,
[data-pretext-mermaid-svg] .messageLine1,
[data-pretext-mermaid-svg] .actor-line,
[data-pretext-mermaid-svg] .relation,
[data-pretext-mermaid-svg] .transition,
[data-pretext-mermaid-svg] line {
  fill: none;
  stroke: var(--muted-foreground);
}
[data-pretext-mermaid-svg] marker path,
[data-pretext-mermaid-svg] marker polygon,
[data-pretext-mermaid-svg] marker circle,
[data-pretext-mermaid-svg] .marker,
[data-pretext-mermaid-svg] .arrowMarkerPath {
  fill: var(--muted-foreground);
  stroke: var(--muted-foreground);
}
`;

const mermaidDiagramCache = new Map<string, Promise<DiagramState>>();
const mermaidScopedSvgCache = new Map<string, string>();

type MermaidApi = {
  initialize?: (config: typeof MERMAID_CONFIG) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

type MmdrApi = {
  render: (source: string) => string;
};

type MmdrExports = {
  memory: WebAssembly.Memory;
  render: (
    sourceLength: number,
    baseThemeLength: number,
    themeLength: number,
    layoutLength: number,
  ) => number;
};

type MermaidRenderJob = {
  reject: (reason: unknown) => void;
  resolve: (state: DiagramState) => void;
  run: () => Promise<DiagramState>;
};

type MermaidIdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout?: number },
    ) => number;
  };

let mermaidApiPromise: Promise<MermaidApi> | null = null;
let mmdrApiPromise: Promise<MmdrApi> | null = null;
let isMmdrUnavailable = false;
let mermaidInitializedConfigKey = "";
let isMermaidRenderQueueRunning = false;
const mermaidRenderQueue: MermaidRenderJob[] = [];

export type DiagramRenderer = "basic" | "mermaid" | "mmdr";
export type DiagramState =
  | { status: "failed"; message: string }
  | { status: "loading" }
  | { renderer: DiagramRenderer; status: "ready"; svg: string };
type ReadyDiagramState = Extract<DiagramState, { status: "ready" }>;

export function resetMermaidRendererForTests() {
  mermaidDiagramCache.clear();
  mermaidScopedSvgCache.clear();
  mermaidRenderQueue.length = 0;
  mermaidApiPromise = null;
  mmdrApiPromise = null;
  isMmdrUnavailable = false;
  mermaidInitializedConfigKey = "";
  isMermaidRenderQueueRunning = false;
}

export async function renderDiagram(
  source: string,
  id: string,
): Promise<DiagramState> {
  const state = await getCachedDiagram(source);
  if (state.status !== "ready") return state;
  const scopedKey = `${DIAGRAM_CACHE_CONFIG_KEY}\0${state.renderer}\0${id}\0${source}`;
  let svg = mermaidScopedSvgCache.get(scopedKey);
  if (!svg) {
    svg = scopeCachedMermaidSvg(state.svg, id);
    mermaidScopedSvgCache.set(scopedKey, svg);
    trimMapToLimit(mermaidScopedSvgCache, MERMAID_SCOPED_CACHE_LIMIT);
  }
  return { renderer: state.renderer, status: "ready", svg };
}

function getCachedDiagram(source: string) {
  const key = `${DIAGRAM_CACHE_CONFIG_KEY}\0${source}`;
  let cached = mermaidDiagramCache.get(key);
  if (!cached) {
    cached = enqueueMermaidRender(() => loadDiagram(source));
    mermaidDiagramCache.set(key, cached);
    trimMapToLimit(mermaidDiagramCache, MERMAID_CACHE_LIMIT);
  }
  return cached;
}

function enqueueMermaidRender(run: () => Promise<DiagramState>) {
  return new Promise<DiagramState>((resolve, reject) => {
    mermaidRenderQueue.push({ reject, resolve, run });
    void drainMermaidRenderQueue();
  });
}

async function drainMermaidRenderQueue() {
  if (isMermaidRenderQueueRunning) return;
  isMermaidRenderQueueRunning = true;
  try {
    for (;;) {
      const job = mermaidRenderQueue.shift();
      if (!job) return;
      try {
        await waitForMermaidRenderSlot();
        job.resolve(await job.run());
      } catch (error) {
        job.reject(error);
      }
    }
  } finally {
    isMermaidRenderQueueRunning = false;
  }
}

function waitForMermaidRenderSlot() {
  if (typeof window === "undefined") return Promise.resolve();
  const idleWindow = window as MermaidIdleWindow;
  if (typeof idleWindow.requestIdleCallback === "function") {
    return new Promise<void>((resolve) => {
      idleWindow.requestIdleCallback?.(() => resolve(), { timeout: 250 });
    });
  }
  if (typeof window.requestAnimationFrame === "function") {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function loadDiagram(source: string): Promise<DiagramState> {
  const mmdrState = await loadMmdrDiagram(source);
  if (mmdrState.status === "ready") return mmdrState;
  return loadMermaidDiagram(source);
}

async function loadMmdrDiagram(source: string): Promise<DiagramState> {
  try {
    const mmdr = await loadMmdrApi();
    return {
      renderer: "mmdr",
      status: "ready",
      svg: sanitizeSvg(mmdr.render(source)),
    };
  } catch {
    return { status: "failed", message: "mmdr unavailable" };
  }
}

async function loadMermaidDiagram(source: string): Promise<DiagramState> {
  try {
    const mermaid = await loadMermaidApi();
    const result = await mermaid.render(
      `markdown-diagram-cache-${hashMermaidSource(source)}`,
      source,
    );
    return {
      renderer: "mermaid",
      status: "ready",
      svg: sanitizeSvg(result.svg),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid diagram";
    if (!/getBBox|layout|force-basic-fallback/i.test(message)) {
      return { status: "failed", message };
    }
    return renderBasicMermaidDiagram(source);
  }
}

async function loadMmdrApi() {
  if (!canUseMmdrRenderer()) {
    throw new Error("mmdr is unavailable in this runtime");
  }
  if (isMmdrUnavailable) {
    throw new Error("mmdr failed to load");
  }
  mmdrApiPromise ??= instantiateMmdrApi().catch((error) => {
    isMmdrUnavailable = true;
    throw error;
  });
  return mmdrApiPromise;
}

async function loadMermaidApi() {
  mermaidApiPromise ??= import("mermaid").then(
    (mermaidModule) => mermaidModule.default as MermaidApi,
  );
  const mermaid = await mermaidApiPromise;
  if (mermaidInitializedConfigKey !== MERMAID_CACHE_CONFIG_KEY) {
    mermaid.initialize?.(MERMAID_CONFIG);
    mermaidInitializedConfigKey = MERMAID_CACHE_CONFIG_KEY;
  }
  return mermaid;
}

function canUseMmdrRenderer() {
  return (
    typeof window !== "undefined" &&
    typeof window.fetch === "function" &&
    typeof WebAssembly !== "undefined" &&
    typeof TextDecoder !== "undefined" &&
    typeof TextEncoder !== "undefined"
  );
}

async function instantiateMmdrApi(): Promise<MmdrApi> {
  let instance: WebAssembly.Instance | null = null;
  let currentArgs: Uint8Array[] = [];
  let currentResult: Uint8Array | null = null;
  const imports = {
    typst_env: {
      wasm_minimal_protocol_send_result_to_host(
        pointer: number,
        length: number,
      ) {
        if (!instance) return;
        const memory = new Uint8Array(
          (instance.exports as unknown as MmdrExports).memory.buffer,
        );
        currentResult = memory.slice(pointer, pointer + length);
      },
      wasm_minimal_protocol_write_args_to_buffer(pointer: number) {
        if (!instance) return;
        const memory = new Uint8Array(
          (instance.exports as unknown as MmdrExports).memory.buffer,
        );
        let offset = pointer;
        for (const arg of currentArgs) {
          memory.set(arg, offset);
          offset += arg.length;
        }
      },
    },
  };
  const response = await window.fetch(MMDR_WASM_URL);
  if (!response.ok) {
    throw new Error(`Failed to load mmdr renderer: ${response.status}`);
  }
  const wasm = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    imports,
  );
  instance = wasm.instance;
  const exports = instance.exports as unknown as MmdrExports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    render(source: string) {
      currentArgs = [
        encoder.encode(source),
        encoder.encode(MMDR_BASE_THEME),
        encoder.encode(MMDR_THEME_JSON),
        encoder.encode(MMDR_LAYOUT),
      ];
      currentResult = null;
      const status = exports.render(
        currentArgs[0]?.length ?? 0,
        currentArgs[1]?.length ?? 0,
        currentArgs[2]?.length ?? 0,
        currentArgs[3]?.length ?? 0,
      );
      const result = decoder.decode(currentResult ?? new Uint8Array());
      currentArgs = [];
      currentResult = null;
      if (status !== 0) {
        throw new Error(result || "mmdr failed to render the diagram");
      }
      return result;
    },
  };
}

function scopeCachedMermaidSvg(svg: string, idPrefix: string) {
  if (typeof DOMParser === "undefined") return svg;
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") return svg;

  const ids = new Map<string, string>();
  for (const element of Array.from(root.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const nextId = `${idPrefix}-${id}`;
    ids.set(id, nextId);
    element.setAttribute("id", nextId);
  }
  if (!ids.size) return new XMLSerializer().serializeToString(root);

  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value;
      let nextValue = value;
      for (const [oldId, nextId] of ids) {
        nextValue = nextValue
          .replaceAll(`url(#${oldId})`, `url(#${nextId})`)
          .replaceAll(`#${oldId}`, `#${nextId}`);
      }
      if (nextValue !== value) element.setAttribute(attribute.name, nextValue);
    }
  }

  return new XMLSerializer().serializeToString(root);
}

function hashMermaidSource(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function renderBasicMermaidDiagram(source: string): ReadyDiagramState {
  const kind = diagramKind(source);
  const lines = readableDiagramLines(source);
  const escaped = escapeHtml(lines.join(" | ") || describeDiagram(source));
  const piePaths =
    kind === "pie"
      ? '<path d="M20 20h20v20H20z"/><path d="M44 20h20v20H44z"/><path d="M68 20h20v20H68z"/>'
      : "";
  return {
    renderer: "basic",
    status: "ready",
    svg: `<svg role="img" aria-label="Mermaid diagram" data-pretext-basic-mermaid="${kind}" viewBox="0 0 720 160" width="100%" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="160" rx="8" fill="currentColor" opacity="0.05"/>${piePaths}<text x="24" y="82" fill="currentColor" font-family="monospace" font-size="16">${escaped}</text></svg>`,
  };
}

function sanitizeSvg(svg: string) {
  if (typeof DOMParser === "undefined") return svg;

  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    const fallback = renderBasicMermaidDiagram("");
    return fallback.status === "ready" ? fallback.svg : "";
  }

  root.setAttribute("role", "img");
  if (!root.getAttribute("aria-label")) {
    root.setAttribute("aria-label", "Mermaid diagram");
  }
  root.setAttribute("data-pretext-sanitized-mermaid", "");

  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    if (
      tagName === "script" ||
      tagName === "a" ||
      tagName === "animate" ||
      tagName === "foreignobject" ||
      tagName === "image" ||
      tagName === "iframe" ||
      tagName === "object" ||
      tagName === "embed" ||
      tagName === "style" ||
      tagName === "use"
    ) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === "id" || name === "name") && isDomClobberingId(value)) {
        element.setAttribute(attribute.name, `user-content-${value}`);
        continue;
      }
      if (
        (name === "href" || name.endsWith(":href") || name === "src") &&
        !isSafeSvgReference(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const attribute of Array.from(root.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || name === "style") {
      root.removeAttribute(attribute.name);
      continue;
    }
    if (
      (name === "id" || name === "name") &&
      isDomClobberingId(attribute.value)
    ) {
      root.setAttribute(attribute.name, `user-content-${attribute.value}`);
    }
  }

  return new XMLSerializer()
    .serializeToString(root)
    .replace(/^<svg\b([^>]*)\brole="([^"]*)"([^>]*)>/, '<svg role="$2"$1$3>');
}

function trimMapToLimit<K, V>(map: Map<K, V>, limit: number) {
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function isSafeSvgReference(value: string) {
  return (
    value === "" ||
    value.startsWith("#") ||
    value.startsWith("data:image/") ||
    /^https?:\/\//i.test(value)
  );
}

export function readDiagramLimitMessage(source: string) {
  if (source.length > MERMAID_MAX_SOURCE_LENGTH) {
    return "Mermaid diagram too large to render safely. Copy the source and render it in a dedicated diagram tool.";
  }
  if (source.split(/\r\n|[\n\r\u2028\u2029]/).length > MERMAID_MAX_LINES) {
    return "Mermaid diagram has too many lines to render safely. Copy the source and render it in a dedicated diagram tool.";
  }
  return null;
}

export function describeDiagram(source: string) {
  const lines = semanticDiagramLines(source);
  const kind = diagramKind(source);
  if (kind === "graph") {
    const direction = lines[0]
      ?.match(/\b(?:graph|flowchart)\s+([A-Z]{2})\b/i)?.[1]
      ?.toUpperCase();
    const directionText = direction === "LR" ? "left to right" : "top down";
    const edges = lines.filter((line) => /-->|---|-.->|==>/.test(line)).length;
    const nodes = new Set<string>();
    for (const line of lines) {
      for (const match of line.matchAll(/\b([A-Za-z][\w-]*)\b/g)) {
        const value = match[1]!;
        if (
          !["graph", "flowchart", "TD", "LR", "TB", "BT", "RL"].includes(value)
        ) {
          nodes.add(value);
        }
      }
    }
    return `Mermaid graph diagram flowing ${directionText}, with ${nodes.size} nodes and ${edges} edge${edges === 1 ? "" : "s"}.`;
  }
  if (kind === "sequence") {
    const messages = lines.filter((line) =>
      /->>|-->>|->|-->/.test(line),
    ).length;
    const participants = new Set<string>();
    for (const line of lines) {
      const participant = /^participant\s+\S+(?:\s+as\s+(.+))?/i.exec(line);
      if (participant)
        participants.add(participant[1] ?? line.split(/\s+/)[1]!);
      for (const side of line.split(/->>|-->>|->|-->/)) {
        const name = side.split(":")[0]?.trim();
        if (name && !/^sequenceDiagram/i.test(name)) participants.add(name);
      }
    }
    return `Mermaid sequence diagram with ${participants.size} participants and ${messages} message${messages === 1 ? "" : "s"}.`;
  }
  if (kind === "state") {
    const transitions = lines.filter((line) => /-->/.test(line)).length;
    const states = new Set<string>();
    for (const line of lines) {
      const stateAlias = /^state\s+"([^"]+)"\s+as\s+(\w+)/.exec(line);
      if (stateAlias) {
        states.add(stateAlias[1]!);
        continue;
      }
      if (!/-->/.test(line)) continue;
      for (const side of line.split(/-->/)) {
        const name = side
          .split(":")[0]!
          .replace(/\[\*\]/g, "")
          .trim();
        if (name && !/^stateDiagram/.test(name)) {
          states.add(name);
        }
      }
    }
    return `Mermaid state diagram with ${states.size} states and ${transitions} transitions.`;
  }
  if (kind === "class") {
    const relationships = lines.filter((line) =>
      /<\|--|--|<--|\.\./.test(line),
    ).length;
    const classes = new Set<string>();
    for (const line of lines) {
      for (const match of line.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g))
        classes.add(match[1]!);
    }
    return `Mermaid class diagram with ${classes.size} classes and ${relationships} relationship${relationships === 1 ? "" : "s"}.`;
  }
  if (kind === "er") {
    const relationships = lines.filter((line) =>
      /\|\||o\{|\|\{/.test(line),
    ).length;
    const entities = new Set<string>();
    for (const line of lines) {
      for (const match of line.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)) {
        if (!["ERDIAGRAM"].includes(match[1]!)) entities.add(match[1]!);
      }
    }
    return `Mermaid entity relationship diagram with ${entities.size} entities and ${relationships} relationships.`;
  }
  if (kind === "journey")
    return `Mermaid journey diagram with ${countLinesStarting(lines, "section ")} sections and ${lines.filter((line) => /:\s*\d+\s*:/.test(line)).length} tasks.`;
  if (kind === "gantt")
    return `Mermaid Gantt chart with ${countLinesStarting(lines, "section ")} sections and ${lines.filter((line) => /:/.test(line) && !/^dateFormat/i.test(line) && !/^title\b/i.test(line)).length} tasks.`;
  if (kind === "gitGraph")
    return `Mermaid Git graph with ${countLinesStarting(lines, "branch ")} branch, ${countExact(lines, "commit")} commits, and ${countLinesStarting(lines, "merge ")} merge.`;
  if (kind === "timeline")
    return `Mermaid timeline with ${countLinesStarting(lines, "section ")} sections and ${lines.filter((line) => /^\d/.test(line)).length} events.`;
  if (kind === "mindmap")
    return `Mermaid mind map with ${Math.max(0, lines.length - 1)} nodes.`;
  if (kind === "quadrantChart")
    return `Mermaid quadrant chart with ${lines.filter((line) => /:\s*\[[^\]]+\]/.test(line)).length} points.`;
  if (kind === "requirementDiagram")
    return `Mermaid requirement diagram with ${countLinesStarting(lines, "requirement ")} requirement, ${countLinesStarting(lines, "element ")} element, and ${lines.filter((line) => /-\s*\w+\s*->/.test(line)).length} relationship.`;
  if (kind === "xychart") {
    const series = lines.filter((line) => /^(bar|line)\s+\[/.test(line));
    const values = series.reduce(
      (sum, line) => sum + (line.match(/-?\d+(?:\.\d+)?/g)?.length ?? 0),
      0,
    );
    return `Mermaid XY chart with ${series.length} series and ${values} values.`;
  }
  if (kind === "sankey") {
    const flows = lines.filter((line) => line.includes(","));
    const nodes = new Set(
      flows.flatMap((line) =>
        line
          .split(",")
          .slice(0, 2)
          .map((item) => item.trim()),
      ),
    );
    return `Mermaid Sankey diagram with ${nodes.size} nodes and ${flows.length} flows.`;
  }
  if (kind === "c4")
    return `Mermaid C4 diagram with ${lines.filter((line) => /^(Person|System)\(/.test(line)).length} nodes and ${countLinesStarting(lines, "Rel(")} relationship.`;
  if (kind === "pie") {
    const values = lines
      .flatMap((line) => line.match(/:\s*(\d+(?:\.\d+)?)/)?.[1] ?? [])
      .map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    return `Mermaid pie chart with ${values.length} slices and total value ${total}.`;
  }
  return "Mermaid diagram";
}

export function estimateDiagramBodyHeight(source: string) {
  switch (diagramKind(source)) {
    case "graph":
      return 286;
    case "sequence":
      return 160;
    case "state":
      return 238;
    case "class":
      return 220;
    case "er":
      return 292;
    case "journey":
      return 270;
    case "gantt":
      return 300;
    case "gitGraph":
      return 212;
    case "timeline":
      return 270;
    case "mindmap":
      return 232;
    case "quadrantChart":
      return 296;
    case "requirementDiagram":
      return 230;
    case "xychart":
      return 334;
    case "sankey":
      return 310;
    case "c4":
      return 236;
    case "pie":
      return 224;
    default:
      return 180;
  }
}

function diagramKind(source: string) {
  const first = semanticDiagramLines(source)[0] ?? "";
  if (/^(?:graph|flowchart)\b/i.test(first)) return "graph";
  if (/^sequenceDiagram\b/i.test(first)) return "sequence";
  if (/^stateDiagram/i.test(first)) return "state";
  if (/^classDiagram\b/i.test(first)) return "class";
  if (/^erDiagram\b/i.test(first)) return "er";
  if (/^journey\b/i.test(first)) return "journey";
  if (/^gantt\b/i.test(first)) return "gantt";
  if (/^gitGraph\b/i.test(first)) return "gitGraph";
  if (/^timeline\b/i.test(first)) return "timeline";
  if (/^mindmap\b/i.test(first)) return "mindmap";
  if (/^quadrantChart\b/i.test(first)) return "quadrantChart";
  if (/^requirementDiagram\b/i.test(first)) return "requirementDiagram";
  if (/^xychart/i.test(first)) return "xychart";
  if (/^sankey/i.test(first)) return "sankey";
  if (/^C4/i.test(first)) return "c4";
  if (/^pie\b/i.test(first)) return "pie";
  return "source";
}

function semanticDiagramLines(source: string) {
  return stripMermaidFrontmatter(source)
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
}

function readableDiagramLines(source: string) {
  const lines = semanticDiagramLines(source);
  if (diagramKind(source) === "pie") {
    return lines.map((line) => {
      const match = /"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)/.exec(line);
      return match ? `${match[1]} ${match[2]} (${match[2]}%)` : line;
    });
  }
  return lines;
}

function stripMermaidFrontmatter(source: string) {
  const lines = source.split(/\r\n|[\n\r\u2028\u2029]/);
  if (lines[0]?.trim() !== "---") return source;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return end === -1 ? source : lines.slice(end + 1).join("\n");
}

function countLinesStarting(lines: readonly string[], prefix: string) {
  return lines.filter((line) => line.startsWith(prefix)).length;
}

function countExact(lines: readonly string[], value: string) {
  return lines.filter((line) => line === value).length;
}

function isDomClobberingId(id: string) {
  return ["constructor", "forms", "images", "location", "__proto__"].includes(
    id,
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
