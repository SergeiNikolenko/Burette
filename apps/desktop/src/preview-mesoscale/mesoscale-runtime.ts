import { MesoscaleExplorer } from "molstar/lib/apps/mesoscale-explorer/app.js";
import { MesoscaleState, getAllEntities, getAllGroups, getEntityDescription, getEntityLabel, getRoots, setGraphicsCanvas3DProps } from "molstar/lib/apps/mesoscale-explorer/data/state.js";
import { LoadModel, openState } from "molstar/lib/apps/mesoscale-explorer/ui/states.js";
import { PluginCommands } from "molstar/lib/mol-plugin/commands.js";
import { Structure } from "molstar/lib/mol-model/structure.js";
import { Loci } from "molstar/lib/mol-model/loci.js";
import { Sphere3D } from "molstar/lib/mol-math/geometry.js";
import { PluginStateSnapshotManager } from "molstar/lib/mol-plugin-state/manager/snapshots.js";
import { Asset } from "molstar/lib/mol-util/assets.js";
import { Unzip } from "molstar/lib/mol-util/zip/zip.js";
import { mesoscaleZipEntries, validateGenericMesoscaleManifest, validateMesoscaleArchiveEntries } from "./mesoscale-package";

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

function uniqueCells<T>(cells: T[]) {
  const seen = new Set<string>();
  return cells.filter((cell: any) => {
    const ref = String(cell?.transform?.ref || "");
    if (!ref || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
}

function entitySummary(plugin: MesoscaleExplorer["plugin"], cell: any) {
  const source = cell?.obj?.data?.sourceData;
  const isStructure = source instanceof Structure;
  return {
    ref: String(cell?.transform?.ref || ""),
    label: getEntityLabel(plugin, cell),
    description: getEntityDescription(plugin, cell),
    hidden: Boolean(cell?.state?.isHidden),
    kind: isStructure ? "structure" : "mesh",
    elementCount: isStructure ? Number(source.elementCount || 0) : 0,
    instanceCount: isStructure ? Math.max(1, Number(source.units?.length || 1)) : Number(cell?.obj?.data?.repr?.renderObjects?.length || 1),
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function validateGenericPackage(runtime: MesoscaleRuntimeApi, bytes: Uint8Array) {
  const archiveReport = validateMesoscaleArchiveEntries(mesoscaleZipEntries(bytes));
  const manifestName = archiveReport.manifest;

  if (manifestName === "manifest.json") {
    const inflated = await runtime.plugin.runTask(Unzip(bytes.slice().buffer as ArrayBuffer)) as Record<string, Uint8Array>;
    const manifestBytes = inflated[manifestName];
    if (!manifestBytes || manifestBytes.length > 4 * 1024 * 1024) throw new Error("Mesoscale manifest is missing or exceeds 4 MiB");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, any>;
    validateGenericMesoscaleManifest(manifest, new Set(Object.keys(inflated)));
  }
  return { entries: archiveReport.entries, expandedBytes: archiveReport.expandedBytes, manifest: manifestName };
}

class MesoscaleRuntimeApi {
  readonly explorer: MesoscaleExplorer;
  loadReport: Record<string, unknown> | null = null;

  constructor(explorer: MesoscaleExplorer) {
    this.explorer = explorer;
  }

  get plugin() {
    return this.explorer.plugin;
  }

  observe() {
    const allGroups = uniqueCells(getAllGroups(this.plugin));
    const allEntities = uniqueCells(getAllEntities(this.plugin));
    const groups = allGroups.slice(0, MAX_OBSERVED_ITEMS);
    const entities = allEntities.slice(0, MAX_OBSERVED_ITEMS);
    const state = MesoscaleState.has(this.plugin) ? MesoscaleState.get(this.plugin) : null;
    const entitySummaries = entities.map((cell: any) => entitySummary(this.plugin, cell));
    const snapshots = Array.from(this.plugin.managers.snapshot.state.entries).slice(0, MAX_OBSERVED_ITEMS);
    return {
      apiVersion: API_VERSION,
      graphics: state?.graphics ?? null,
      filter: state?.filter ?? "",
      counts: {
        roots: uniqueCells(Array.from(getRoots(this.plugin))).length,
        groups: allGroups.length,
        entities: allEntities.length,
        instances: allEntities.reduce((total, cell: any) => total + entitySummary(this.plugin, cell).instanceCount, 0),
        elements: allEntities.reduce((total, cell: any) => total + entitySummary(this.plugin, cell).elementCount, 0),
        meshes: allEntities.filter((cell: any) => entitySummary(this.plugin, cell).kind === "mesh").length,
        snapshots: this.plugin.managers.snapshot.state.entries.size,
      },
      truncated: allGroups.length > groups.length || allEntities.length > entities.length,
      groups: groups.map(groupSummary),
      entities: entitySummaries,
      snapshots: snapshots.map((entry: any) => ({
        id: String(entry?.snapshot?.id || ""),
        name: String(entry?.name || ""),
        description: String(entry?.description || "").slice(0, 1024),
        current: this.plugin.managers.snapshot.state.current === entry?.snapshot?.id,
      })),
      loadReport: this.loadReport,
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

  private entity(ref: string) {
    const entity = uniqueCells(getAllEntities(this.plugin)).find((cell: any) => cell?.transform?.ref === ref);
    if (!entity) throw new Error(`Mesoscale entity not found: ${ref}`);
    return entity;
  }

  async setVisibility(ref: string, visible: boolean) {
    const cell = [...uniqueCells(getAllGroups(this.plugin)), ...uniqueCells(getAllEntities(this.plugin))]
      .find((candidate: any) => candidate?.transform?.ref === ref);
    if (!cell) throw new Error(`Mesoscale object not found: ${ref}`);
    if (!cell.parent) throw new Error(`Mesoscale object has no state owner: ${ref}`);
    if (Boolean(cell.state?.isHidden) === visible) {
      await PluginCommands.State.ToggleVisibility(this.plugin, { state: cell.parent, ref });
    }
    return this.observe();
  }

  async selectEntity(ref: string, mode: "replace" | "extend" | "toggle" = "replace") {
    const cell: any = this.entity(ref);
    const source = cell?.obj?.data?.sourceData;
    if (!(source instanceof Structure)) throw new Error(`Entity is not selectable as a molecular structure: ${ref}`);
    const loci = Structure.toStructureElementLoci(source);
    const selection = this.plugin.managers.interactivity.lociSelects;
    if (mode === "replace") selection.selectOnly({ loci }, false);
    else if (mode === "extend") selection.selectJoin({ loci }, false);
    else selection.toggle({ loci }, false);
    return this.observe();
  }

  async focusEntity(ref: string) {
    const cell: any = this.entity(ref);
    const source = cell?.obj?.data?.sourceData;
    if (!(source instanceof Structure)) throw new Error(`Entity has no molecular focus target: ${ref}`);
    const loci = Structure.toStructureElementLoci(source);
    const sphere = Loci.getBoundingSphere(loci) || Sphere3D();
    this.plugin.managers.camera.focusSphere(sphere, { durationMs: 250 });
    await MesoscaleState.set(this.plugin, { focusInfo: getEntityDescription(this.plugin, cell) });
    return this.observe();
  }

  async styleEntity(ref: string, values: Record<string, unknown>) {
    const cell: any = this.entity(ref);
    const opacity = values.opacity === undefined ? undefined : Math.min(1, Math.max(0, Number(values.opacity)));
    const emissive = values.emissive === undefined ? undefined : Math.min(1, Math.max(0, Number(values.emissive)));
    const color = values.color === undefined ? undefined : Number(values.color);
    const clipObjects = Array.isArray(values.clipObjects) ? values.clipObjects.slice(0, 6) : undefined;
    await this.plugin.state.data.build().to(cell).update((old: any) => {
      const params = old.type ? old.type.params : old;
      if (opacity !== undefined && Number.isFinite(opacity)) {
        params.alpha = opacity;
        params.xrayShaded = opacity < 1 ? (old.type ? "inverted" : true) : false;
      }
      if (emissive !== undefined && Number.isFinite(emissive)) params.emissive = emissive;
      if (color !== undefined && Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
        if (old.colorTheme?.params) old.colorTheme.params.value = color;
        if (old.coloring?.params) old.coloring.params.color = color;
      }
      if (clipObjects) {
        params.clip = { ...(params.clip || {}), objects: clipObjects };
      }
    }).commit();
    await MesoscaleState.set(this.plugin, { graphics: "custom" });
    return this.observe();
  }

  async createSnapshot(name: string, description: string) {
    const snapshot = this.plugin.state.getSnapshot({});
    const entry = PluginStateSnapshotManager.Entry(snapshot, {
      name: name.slice(0, 128),
      description: description.slice(0, 2048),
      descriptionFormat: "plaintext",
    });
    this.plugin.managers.snapshot.add(entry);
    return this.observe();
  }

  async applySnapshot(id: string) {
    const snapshot = this.plugin.managers.snapshot.setCurrent(id);
    if (!snapshot) throw new Error(`Mesoscale snapshot not found: ${id}`);
    await this.plugin.state.setSnapshot(snapshot);
    return this.observe();
  }

  async deleteSnapshot(id: string) {
    if (!this.plugin.managers.snapshot.getEntry(id)) throw new Error(`Mesoscale snapshot not found: ${id}`);
    this.plugin.managers.snapshot.remove(id);
    return this.observe();
  }

  async exportState(type: "molx" | "molj" = "molx") {
    const blob = await this.plugin.managers.snapshot.serialize({ type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(window.BuretteConfig?.label || "mesoscale-session").replace(/\.[^.]+$/u, "")}.${type}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { type, bytes: blob.size };
  }

  async exportPng() {
    const screenshot = this.plugin.helpers.viewportScreenshot;
    if (!screenshot) throw new Error("Mesoscale PNG export is unavailable");
    screenshot.download(`${String(window.BuretteConfig?.label || "mesoscale").replace(/\.[^.]+$/u, "")}.png`);
    return { type: "png", requested: true };
  }

  capabilities() {
    return {
      apiVersion: API_VERSION,
      commands: ["capabilities", "summary", "resetCamera", "setGraphics", "setFilter", "toggleGroup", "setVisibility", "selectEntity", "focusEntity", "styleEntity", "createSnapshot", "applySnapshot", "deleteSnapshot", "exportState", "exportPng"],
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
      case "setVisibility": return this.setVisibility(String(args.ref || ""), args.visible !== false);
      case "selectEntity": return this.selectEntity(String(args.ref || ""), String(args.mode || "replace") as "replace" | "extend" | "toggle");
      case "focusEntity": return this.focusEntity(String(args.ref || ""));
      case "styleEntity": return this.styleEntity(String(args.ref || ""), args);
      case "createSnapshot": return this.createSnapshot(String(args.name || "Snapshot"), String(args.description || ""));
      case "applySnapshot": return this.applySnapshot(String(args.id || ""));
      case "deleteSnapshot": return this.deleteSnapshot(String(args.id || ""));
      case "exportState": return this.exportState(String(args.type || "molx") as "molx" | "molj");
      case "exportPng": return this.exportPng();
      default: throw new Error(`Unsupported mesoscale action: ${String(action.type || "")}`);
    }
  }
}

async function loadSource(runtime: MesoscaleRuntimeApi, config: MesoscaleConfig) {
  const startedAt = performance.now();
  const bytes = await sourceBytes();
  const file = sourceFile(config, bytes);
  const extension = normalizedExtension(config);
  const packageReport = extension === "mesozip" ? await validateGenericPackage(runtime, bytes) : null;
  if (extension === "molx" || extension === "molj") {
    await openState(runtime.plugin, file);
  } else {
    await runtime.plugin.runTask(runtime.plugin.state.data.applyAction(LoadModel, { files: [Asset.File(file)] }));
  }
  const counts = runtime.observe().counts;
  if (Number(counts.groups) === 0 || Number(counts.entities) === 0) {
    throw new Error("Mesoscale source did not produce a non-empty hierarchy");
  }
  runtime.loadReport = {
    schemaVersion: 1,
    kind: extension === "mesozip" ? "generic-package" : extension === "molx" || extension === "molj" ? "session" : "mesoscale-cif",
    sourceExtension: extension,
    sourceBytes: bytes.length,
    sourceSha256: await sha256(bytes),
    package: packageReport,
    counts,
    loadMs: Math.round(performance.now() - startedAt),
    warnings: [],
  };
}

function installActionBridge(runtime: MesoscaleRuntimeApi) {
  window.addEventListener("message", (event) => {
    const envelope = event.data;
    const body = envelope?.source === "burette-agent-host" ? envelope.body : envelope;
    if (body?.type !== "agent-action" || typeof body.id !== "string") return;
    const reply = (result: Record<string, unknown>) => (event.source as Window | null)?.postMessage({
      source: "burette-agent-viewer",
      body: { type: "agent-action-result", id: body.id, result },
    }, "*");
    const expectedDocumentId = window.BuretteConfig?.documentId;
    if (event.source !== window.parent || body.documentId && expectedDocumentId && body.documentId !== expectedDocumentId) {
      reply({ ok: false, error: { code: "STALE_TARGET", message: "Mesoscale action target is stale or belongs to another document" } });
      return;
    }
    void runtime.run(body.action ?? {}).then(
      (result) => reply({ ok: true, command: String(body.action?.type || "unknown"), result }),
      (error) => reply({ ok: false, command: String(body.action?.type || "unknown"), error: { code: "MESOSCALE_ACTION_FAILED", message: String(error?.message || error) } }),
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
  postHostMessage({ type: "mesoscale_ready", message: "Mesoscale runtime ready", apiVersion: API_VERSION, observe: runtime.observe() });
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
