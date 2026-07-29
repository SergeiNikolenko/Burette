import { MesoscaleExplorer } from "molstar/lib/apps/mesoscale-explorer/app.js";
import { MesoscaleState, getAllEntities, getAllGroups, getEntityDescription, getEntityLabel, getRoots, setGraphicsCanvas3DProps } from "molstar/lib/apps/mesoscale-explorer/data/state.js";
import { LoadModel, openState } from "molstar/lib/apps/mesoscale-explorer/ui/states.js";
import { PluginCommands } from "molstar/lib/mol-plugin/commands.js";
import { Asset } from "molstar/lib/mol-util/assets.js";

type GraphicsMode = "ultra" | "quality" | "balanced" | "performance" | "custom";

type MesoscaleConfig = {
  documentId?: string;
  format?: string;
  graphicsMode?: GraphicsMode;
  label?: string;
  sourceExtension?: string;
};

type AgentAction = {
  type?: string;
  args?: Record<string, unknown>;
};

declare global {
  interface Window {
    BuretteConfig?: MesoscaleConfig;
    BuretteDataBase64?: string;
    BuretteDataURL?: string;
    BuretteMesoscale?: MesoscaleRuntimeApi;
    webkit?: {
      messageHandlers?: {
        burette?: { postMessage: (body: Record<string, unknown>) => void };
      };
    };
  }
}

const API_VERSION = "burette-mesoscale/v1";
const MAX_OBSERVED_ITEMS = 128;

function postHostMessage(payload: Record<string, unknown>) {
  const config = window.BuretteConfig ?? {};
  const body = {
    ...payload,
    ...(config.documentId ? { documentId: config.documentId } : {}),
  };
  const nativeBridge = window.webkit?.messageHandlers?.burette;
  if (nativeBridge) {
    nativeBridge.postMessage(body);
    return;
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ source: "burette-viewer", body }, "*");
  }
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sourceBytes() {
  if (window.BuretteDataBase64) return bytesFromBase64(window.BuretteDataBase64);
  if (!window.BuretteDataURL) throw new Error("Mesoscale source data is unavailable");
  const response = await fetch(window.BuretteDataURL);
  if (!response.ok) throw new Error(`Mesoscale source returned HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function normalizedExtension(config: MesoscaleConfig) {
  const configured = String(config.sourceExtension || config.format || "").toLowerCase().replace(/^\./u, "");
  if (configured === "mmcif") return "cif";
  return configured || "cif";
}

function sourceFile(config: MesoscaleConfig, bytes: Uint8Array) {
  const extension = normalizedExtension(config);
  const fallback = `mesoscale.${extension}`;
  const label = String(config.label || fallback);
  const name = label.toLowerCase().endsWith(`.${extension}`) ? label : fallback;
  const buffer = bytes.slice().buffer as ArrayBuffer;
  return new File([buffer], name, { type: extension === "molj" ? "application/json" : "application/octet-stream" });
}

function cellLabel(cell: any) {
  return String(cell?.obj?.label || cell?.params?.values?.label || "Untitled");
}

function groupSummary(cell: any) {
  return {
    ref: String(cell?.transform?.ref || ""),
    label: cellLabel(cell),
    description: String(cell?.obj?.description || cell?.params?.values?.description || ""),
    tag: String(cell?.params?.values?.tag || ""),
    hidden: Boolean(cell?.state?.isHidden),
  };
}

class MesoscaleRuntimeApi {
  readonly explorer: MesoscaleExplorer;

  constructor(explorer: MesoscaleExplorer) {
    this.explorer = explorer;
  }

  get plugin() {
    return this.explorer.plugin;
  }

  observe() {
    const allGroups = getAllGroups(this.plugin);
    const allEntities = getAllEntities(this.plugin);
    const groups = allGroups.slice(0, MAX_OBSERVED_ITEMS);
    const entities = allEntities.slice(0, MAX_OBSERVED_ITEMS);
    const state = MesoscaleState.has(this.plugin) ? MesoscaleState.get(this.plugin) : null;
    return {
      apiVersion: API_VERSION,
      graphics: state?.graphics ?? null,
      filter: state?.filter ?? "",
      counts: {
        roots: getRoots(this.plugin).length,
        groups: allGroups.length,
        entities: allEntities.length,
      },
      truncated: allGroups.length > groups.length || allEntities.length > entities.length,
      groups: groups.map(groupSummary),
      entities: entities.map((cell: any) => ({
        ref: String(cell?.transform?.ref || ""),
        label: getEntityLabel(this.plugin, cell),
        description: getEntityDescription(this.plugin, cell),
        hidden: Boolean(cell?.state?.isHidden),
      })),
    };
  }

  async resetCamera() {
    this.plugin.managers.camera.reset(undefined, 250);
    return this.observe();
  }

  async setGraphics(graphics: GraphicsMode) {
    if (!["ultra", "quality", "balanced", "performance", "custom"].includes(graphics)) {
      throw new Error(`Unsupported graphics mode: ${graphics}`);
    }
    await MesoscaleState.set(this.plugin, { graphics });
    if (graphics !== "custom") setGraphicsCanvas3DProps(this.plugin, graphics);
    return this.observe();
  }

  async setFilter(filter: string) {
    await MesoscaleState.set(this.plugin, { filter: filter.slice(0, 256) });
    return this.observe();
  }

  async toggleGroup(ref: string) {
    const group = getAllGroups(this.plugin).find((cell: any) => cell?.transform?.ref === ref);
    if (!group) throw new Error(`Mesoscale group not found: ${ref}`);
    if (!group.parent) throw new Error(`Mesoscale group has no state owner: ${ref}`);
    await PluginCommands.State.ToggleVisibility(this.plugin, { state: group.parent, ref });
    return this.observe();
  }

  capabilities() {
    return {
      apiVersion: API_VERSION,
      commands: ["capabilities", "summary", "resetCamera", "setGraphics", "setFilter", "toggleGroup"],
      graphicsModes: ["ultra", "quality", "balanced", "performance", "custom"],
      boundedObserveLimit: MAX_OBSERVED_ITEMS,
    };
  }

  async run(action: AgentAction) {
    const args = action.args ?? {};
    switch (action.type) {
      case "capabilities": return this.capabilities();
      case "summary": return this.observe();
      case "resetCamera": return this.resetCamera();
      case "setGraphics": return this.setGraphics(String(args.graphics || "balanced") as GraphicsMode);
      case "setFilter": return this.setFilter(String(args.filter || ""));
      case "toggleGroup": return this.toggleGroup(String(args.ref || ""));
      default: throw new Error(`Unsupported mesoscale action: ${String(action.type || "")}`);
    }
  }
}

async function loadSource(runtime: MesoscaleRuntimeApi, config: MesoscaleConfig) {
  const bytes = await sourceBytes();
  const file = sourceFile(config, bytes);
  const extension = normalizedExtension(config);
  if (extension === "molx" || extension === "molj") {
    await openState(runtime.plugin, file);
  } else {
    await runtime.plugin.runTask(runtime.plugin.state.data.applyAction(LoadModel, { files: [Asset.File(file)] }));
  }
}

function installActionBridge(runtime: MesoscaleRuntimeApi) {
  window.addEventListener("message", (event) => {
    const envelope = event.data;
    const body = envelope?.source === "burette-agent-host" ? envelope.body : envelope;
    if (body?.type !== "agent-action" || typeof body.id !== "string") return;
    const reply = (result: Record<string, unknown>) => (event.source as Window | null)?.postMessage({
      source: "burette-viewer",
      body: { type: "agent-action-result", id: body.id, result },
    }, "*");
    void runtime.run(body.action ?? {}).then(
      (result) => reply({ ok: true, result }),
      (error) => reply({ ok: false, error: { code: "MESOSCALE_ACTION_FAILED", message: String(error?.message || error) } }),
    );
  });
}

async function start() {
  const config = window.BuretteConfig ?? {};
  const explorer = await MesoscaleExplorer.create("app", {
    extensions: [],
    graphicsMode: config.graphicsMode ?? "balanced",
    layoutIsExpanded: false,
    layoutShowControls: true,
    layoutShowRemoteState: false,
    layoutShowSequence: false,
    layoutShowLog: true,
    viewportShowAnimation: true,
    viewportShowTrajectoryControls: false,
  });
  const runtime = new MesoscaleRuntimeApi(explorer);
  window.BuretteMesoscale = runtime;
  installActionBridge(runtime);
  await loadSource(runtime, config);
  explorer.handleResize();
  postHostMessage({ type: "agentReady", message: "Burette Mesoscale agent ready", apiVersion: API_VERSION });
  postHostMessage({ type: "structureLoaded", message: `Loaded ${String(config.label || "mesoscale model")}`, mesoscale: runtime.observe() });
}

void start().catch((error) => {
  console.error(error);
  const status = document.getElementById("status");
  status?.classList.remove("hidden");
  if (status) status.textContent = `Unable to load mesoscale model: ${String(error?.message || error)}`;
  postHostMessage({ type: "error", message: String(error?.message || error), code: "MESOSCALE_LOAD_FAILED" });
});
