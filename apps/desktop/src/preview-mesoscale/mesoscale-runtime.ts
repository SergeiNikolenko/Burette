import { MesoscaleExplorer } from "molstar/lib/apps/mesoscale-explorer/app.js";
import { MesoscaleState, getAllEntities, getAllGroups, getEntityDescription, getEntityLabel, getRoots, setGraphicsCanvas3DProps } from "molstar/lib/apps/mesoscale-explorer/data/state.js";
import { LoadModel, openState } from "molstar/lib/apps/mesoscale-explorer/ui/states.js";
import { PluginCommands } from "molstar/lib/mol-plugin/commands.js";
import { Structure } from "molstar/lib/mol-model/structure.js";
import { EveryLoci, Loci } from "molstar/lib/mol-model/loci.js";
import { Sphere3D } from "molstar/lib/mol-math/geometry.js";
import { PluginStateSnapshotManager } from "molstar/lib/mol-plugin-state/manager/snapshots.js";
import { Asset } from "molstar/lib/mol-util/assets.js";
import { Unzip } from "molstar/lib/mol-util/zip/zip.js";
import { Color } from "molstar/lib/mol-util/color/index.js";
import { MarkerAction } from "molstar/lib/mol-util/marker-action.js";
import { mesoscaleZipEntries, validateGenericMesoscaleManifest, validateMesoscaleArchiveEntries } from "./mesoscale-package";
import {
  MESOSCALE_API_VERSION,
  MESOSCALE_HIERARCHY_PAGE_LIMIT,
  type MesoscaleAction,
  type MesoscaleGraphicsMode,
  type MesoscaleHierarchyObject,
  type MesoscaleLayoutRegion,
  type MesoscaleMotion,
  type MesoscalePreviewMessage,
  type MesoscaleRequest,
  type MesoscaleResult,
  type MesoscaleSceneSummary,
} from "../lib/mesoscale-contract";

type GraphicsMode = MesoscaleGraphicsMode;

type MesoscaleConfig = {
  documentId?: string;
  format?: string;
  graphicsMode?: GraphicsMode;
  label?: string;
  sourceExtension?: string;
  uiMode?: "hosted" | "standalone" | "diagnostic";
  theme?: "auto" | "dark" | "light";
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
    parentRef: String(cell?.transform?.parent || "") || null,
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
    parentRef: String(cell?.transform?.parent || "") || null,
    label: getEntityLabel(plugin, cell),
    description: getEntityDescription(plugin, cell),
    hidden: Boolean(cell?.state?.isHidden),
    kind: (isStructure ? "structure" : "mesh") as "structure" | "mesh",
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
  revision = 0;
  readonly selectedRefs = new Set<string>();
  readonly visibilityOverrides = new Map<string, boolean>();
  readonly layoutRegions: Record<MesoscaleLayoutRegion, boolean> = { left: false, right: false };
  motion: MesoscaleMotion = "off";
  previewSequence = 0;

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
      revision: this.revision,
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

  sceneSummary(): MesoscaleSceneSummary {
    const observed = this.observe();
    const hierarchyPreview = [
      ...observed.groups.map((item: ReturnType<typeof groupSummary>) => ({
        ...item,
        hidden: this.visibilityOverrides.get(item.ref) ?? item.hidden,
        kind: "group" as const,
        selected: this.selectedRefs.has(item.ref),
        elementCount: 0,
        instanceCount: 0,
      })),
      ...observed.entities.map((item: ReturnType<typeof entitySummary>) => ({
        ...item,
        hidden: this.visibilityOverrides.get(item.ref) ?? item.hidden,
        selected: this.selectedRefs.has(item.ref),
      })),
    ].slice(0, MESOSCALE_HIERARCHY_PAGE_LIMIT);
    return {
      kind: "summary",
      revision: this.revision,
      graphics: observed.graphics as GraphicsMode | null,
      filter: observed.filter,
      counts: observed.counts,
      selectedRefs: Array.from(this.selectedRefs).slice(0, MAX_OBSERVED_ITEMS),
      selectionMode: Boolean(this.plugin.selectionMode),
      illumination: Boolean(this.plugin.canvas3d?.props.illumination.enabled),
      layout: { ...this.layoutRegions },
      motion: this.motion,
      snapshots: observed.snapshots,
      hierarchyPreview,
      hierarchyTotal: observed.counts.groups + observed.counts.entities,
      loadReport: this.loadReport as MesoscaleSceneSummary["loadReport"],
    };
  }

  hierarchyPage(filter = "", cursor = 0, requestedLimit = MESOSCALE_HIERARCHY_PAGE_LIMIT) {
    const normalizedFilter = filter.trim().toLocaleLowerCase().slice(0, 256);
    const limit = Math.max(1, Math.min(MESOSCALE_HIERARCHY_PAGE_LIMIT, Math.trunc(requestedLimit) || MESOSCALE_HIERARCHY_PAGE_LIMIT));
    const groups: MesoscaleHierarchyObject[] = uniqueCells(getAllGroups(this.plugin)).map((cell: any) => {
      const summary = groupSummary(cell);
      return {
        ...summary,
        hidden: this.visibilityOverrides.get(summary.ref) ?? summary.hidden,
        kind: "group" as const,
        selected: this.selectedRefs.has(summary.ref),
        elementCount: 0,
        instanceCount: 0,
      };
    });
    const entities: MesoscaleHierarchyObject[] = uniqueCells(getAllEntities(this.plugin)).map((cell: any) => {
      const summary = entitySummary(this.plugin, cell);
      return {
        ...summary,
        hidden: this.visibilityOverrides.get(summary.ref) ?? summary.hidden,
        selected: this.selectedRefs.has(summary.ref),
      };
    });
    const all = [...groups, ...entities].filter((item) => !normalizedFilter
      || item.label.toLocaleLowerCase().includes(normalizedFilter)
      || item.description.toLocaleLowerCase().includes(normalizedFilter));
    const start = Math.max(0, Math.min(all.length, Math.trunc(cursor) || 0));
    const items = all.slice(start, start + limit);
    return {
      kind: "hierarchy-page" as const,
      revision: this.revision,
      filter: normalizedFilter,
      cursor: start,
      nextCursor: start + items.length < all.length ? start + items.length : null,
      total: all.length,
      items,
    };
  }

  private changed() {
    this.revision += 1;
  }

  async resetCamera() {
    this.plugin.managers.camera.reset(undefined, 250);
    this.changed();
    return this.observe();
  }

  async setGraphics(graphics: GraphicsMode) {
    if (!["ultra", "quality", "balanced", "performance", "custom"].includes(graphics)) {
      throw new Error(`Unsupported graphics mode: ${graphics}`);
    }
    await MesoscaleState.set(this.plugin, { graphics });
    if (graphics !== "custom") setGraphicsCanvas3DProps(this.plugin, graphics);
    this.changed();
    return this.observe();
  }

  async setFilter(filter: string) {
    await MesoscaleState.set(this.plugin, { filter: filter.slice(0, 256) });
    this.changed();
    return this.observe();
  }

  async toggleGroup(ref: string) {
    const group = getAllGroups(this.plugin).find((cell: any) => cell?.transform?.ref === ref);
    if (!group) throw new Error(`Mesoscale group not found: ${ref}`);
    if (!group.parent) throw new Error(`Mesoscale group has no state owner: ${ref}`);
    await PluginCommands.State.ToggleVisibility(this.plugin, { state: group.parent, ref });
    this.changed();
    return this.observe();
  }

  private entity(ref: string) {
    const entity = uniqueCells(getAllEntities(this.plugin)).find((cell: any) => cell?.transform?.ref === ref);
    if (!entity) throw new Error(`Mesoscale entity not found: ${ref}`);
    return entity;
  }

  highlightObject(ref: string | null, sequence: number) {
    if (sequence < this.previewSequence) return;
    this.previewSequence = sequence;
    const canvas = this.plugin.canvas3d;
    canvas?.mark({ loci: EveryLoci }, MarkerAction.RemoveHighlight);
    if (!ref) return;
    const group = uniqueCells(getAllGroups(this.plugin)).find((cell: any) => cell?.transform?.ref === ref) as any;
    const entities = group
      ? uniqueCells(getAllEntities(this.plugin, String(group?.params?.values?.tag || "")))
      : uniqueCells(getAllEntities(this.plugin)).filter((cell: any) => cell?.transform?.ref === ref);
    for (const entity of entities as any[]) {
      const repr = entity?.obj?.data?.repr;
      if (repr) canvas?.mark({ repr, loci: EveryLoci }, MarkerAction.Highlight);
    }
  }

  setSelectionMode(enabled: boolean) {
    this.plugin.selectionMode = enabled;
    this.changed();
    return this.observe();
  }

  setIllumination(enabled: boolean) {
    this.plugin.canvas3d?.setProps({ illumination: { enabled } });
    this.plugin.canvas3d?.requestDraw();
    this.changed();
    return this.observe();
  }

  async setLayoutRegion(region: MesoscaleLayoutRegion, visible: boolean) {
    if (region !== "left" && region !== "right") throw new Error(`Unsupported Mesoscale layout region: ${String(region)}`);
    const nextRegions = { ...this.layoutRegions, [region]: visible };
    const showControls = nextRegions.left || nextRegions.right;
    await PluginCommands.Layout.Update(this.plugin, {
      state: {
        showControls,
        regionState: {
          ...this.plugin.layout.state.regionState,
          left: nextRegions.left ? "full" : "hidden",
          right: nextRegions.right ? "full" : "hidden",
          top: "hidden",
          bottom: "hidden",
        },
      },
    });
    this.layoutRegions.left = nextRegions.left;
    this.layoutRegions.right = nextRegions.right;
    this.changed();
    return this.observe();
  }

  setMotion(motion: MesoscaleMotion) {
    if (motion !== "off" && motion !== "spin" && motion !== "rock") throw new Error(`Unsupported Mesoscale motion: ${String(motion)}`);
    const trackball = this.plugin.canvas3d?.props.trackball;
    if (!trackball) throw new Error("Mesoscale camera controls are unavailable");
    const animate = motion === "spin"
      ? { name: "spin" as const, params: { speed: 0.1, axis: [0, -1, 0] as [number, number, number] } }
      : motion === "rock"
        ? { name: "rock" as const, params: { speed: 0.3, angle: 10, axis: [0, -1, 0] as [number, number, number] } }
        : { name: "off" as const, params: {} };
    this.plugin.canvas3d?.setProps({ trackball: { ...trackball, animate } });
    this.motion = motion;
    this.changed();
    return this.observe();
  }

  async setVisibility(ref: string, visible: boolean) {
    const cell = [...uniqueCells(getAllGroups(this.plugin)), ...uniqueCells(getAllEntities(this.plugin))]
      .find((candidate: any) => candidate?.transform?.ref === ref);
    if (!cell) throw new Error(`Mesoscale object not found: ${ref}`);
    if (!cell.parent) throw new Error(`Mesoscale object has no state owner: ${ref}`);
    if (Boolean(cell.state?.isHidden) === visible) {
      await PluginCommands.State.ToggleVisibility(this.plugin, { state: cell.parent, ref });
    }
    this.visibilityOverrides.set(ref, !visible);
    this.changed();
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
    if (mode === "replace") {
      this.selectedRefs.clear();
      this.selectedRefs.add(ref);
    } else if (mode === "extend") {
      this.selectedRefs.add(ref);
    } else if (this.selectedRefs.has(ref)) {
      this.selectedRefs.delete(ref);
    } else {
      this.selectedRefs.add(ref);
    }
    this.changed();
    return this.observe();
  }

  clearSelection() {
    this.plugin.managers.interactivity.lociSelects.deselectAll();
    this.selectedRefs.clear();
    this.changed();
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
    this.changed();
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
    this.changed();
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
    this.changed();
    return this.observe();
  }

  async applySnapshot(id: string) {
    const snapshot = this.plugin.managers.snapshot.setCurrent(id);
    if (!snapshot) throw new Error(`Mesoscale snapshot not found: ${id}`);
    await this.plugin.state.setSnapshot(snapshot);
    this.selectedRefs.clear();
    this.visibilityOverrides.clear();
    this.changed();
    return this.observe();
  }

  async deleteSnapshot(id: string) {
    if (!this.plugin.managers.snapshot.getEntry(id)) throw new Error(`Mesoscale snapshot not found: ${id}`);
    this.plugin.managers.snapshot.remove(id);
    this.changed();
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

  private isUnderRef(cell: any, refs: Set<string>) {
    let ref = String(cell?.transform?.ref || "");
    const state = cell?.parent;
    const visited = new Set<string>();
    while (ref && !visited.has(ref)) {
      if (refs.has(ref)) return true;
      visited.add(ref);
      const parent = state?.cells?.get(ref)?.transform?.parent;
      ref = typeof parent === "string" ? parent : "";
    }
    return false;
  }

  async isolateObjects(refs: string[]) {
    const requested = new Set(refs.filter(Boolean).slice(0, MAX_OBSERVED_ITEMS));
    if (requested.size === 0) throw new Error("At least one mesoscale object is required for isolation");
    const cells = [...uniqueCells(getAllGroups(this.plugin)), ...uniqueCells(getAllEntities(this.plugin))];
    if (!cells.some((cell: any) => requested.has(String(cell?.transform?.ref || "")))) {
      throw new Error("None of the requested mesoscale objects exist");
    }
    for (const cell of cells as any[]) {
      const visible = this.isUnderRef(cell, requested);
      if (!cell?.parent || Boolean(cell.state?.isHidden) !== visible) continue;
      await PluginCommands.State.ToggleVisibility(this.plugin, { state: cell.parent, ref: cell.transform.ref });
      this.visibilityOverrides.set(String(cell.transform.ref), !visible);
    }
    this.changed();
    return this.observe();
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

  async runV2(action: MesoscaleAction): Promise<MesoscaleResult> {
    switch (action.type) {
      case "getSummary": return this.sceneSummary();
      case "getHierarchyPage": return this.hierarchyPage(action.filter, action.cursor, action.limit);
      case "setGraphics": await this.setGraphics(action.graphics); return this.sceneSummary();
      case "setFilter": await this.setFilter(action.filter); return this.sceneSummary();
      case "setSelection":
        if (action.mode === "clear" || !action.ref) this.clearSelection();
        else await this.selectEntity(action.ref, action.mode ?? "replace");
        return this.sceneSummary();
      case "setSelectionMode": this.setSelectionMode(action.enabled); return this.sceneSummary();
      case "setIllumination": this.setIllumination(action.enabled); return this.sceneSummary();
      case "setLayoutRegion": await this.setLayoutRegion(action.region, action.visible); return this.sceneSummary();
      case "setMotion": this.setMotion(action.motion); return this.sceneSummary();
      case "focusObject": await this.focusEntity(action.ref); return this.sceneSummary();
      case "setVisibility": await this.setVisibility(action.ref, action.visible); return this.sceneSummary();
      case "isolateObjects": await this.isolateObjects(action.refs); return this.sceneSummary();
      case "setStyle": await this.styleEntity(action.ref, action); return this.sceneSummary();
      case "resetCamera": await this.resetCamera(); return this.sceneSummary();
      case "createSnapshot": await this.createSnapshot(action.name, action.description ?? ""); return this.sceneSummary();
      case "applySnapshot": await this.applySnapshot(action.id); return this.sceneSummary();
      case "deleteSnapshot": await this.deleteSnapshot(action.id); return this.sceneSummary();
      case "exportState": {
        const result = await this.exportState(action.format ?? "molx");
        return { kind: "export", revision: this.revision, type: result.type, bytes: result.bytes };
      }
      case "exportPng": {
        const result = await this.exportPng();
        return { kind: "export", revision: this.revision, type: "png", requested: result.requested };
      }
      case "getCapabilities": return {
        kind: "capabilities",
        apiVersion: MESOSCALE_API_VERSION,
        actions: ["getSummary", "getHierarchyPage", "setGraphics", "setFilter", "setSelection", "setSelectionMode", "setIllumination", "setLayoutRegion", "setMotion", "focusObject", "setVisibility", "isolateObjects", "setStyle", "resetCamera", "createSnapshot", "applySnapshot", "deleteSnapshot", "exportState", "exportPng", "getCapabilities"],
        graphicsModes: ["ultra", "quality", "balanced", "performance", "custom"],
        hierarchyPageLimit: MESOSCALE_HIERARCHY_PAGE_LIMIT,
      };
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

function resolveViewerTheme(theme: MesoscaleConfig["theme"]) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyViewerTheme(runtime: MesoscaleRuntimeApi, theme: MesoscaleConfig["theme"]) {
  const resolved = resolveViewerTheme(theme);
  document.documentElement.dataset.buretteTheme = resolved;
  document.body?.classList.toggle("buret-theme-light", resolved === "light");
  document.body?.classList.toggle("buret-theme-dark", resolved === "dark");
  document.body?.style.setProperty("background-color", resolved === "light" ? "#ffffff" : "#101010");
  runtime.plugin.canvas3d?.setProps({
    transparentBackground: false,
    renderer: { backgroundColor: Color(resolved === "light" ? 0xffffff : 0x101010) },
  });
  runtime.plugin.canvas3d?.requestDraw();
}

function applyHostedUi(hosted: boolean) {
  document.body?.classList.toggle("burette-mesoscale-hosted", hosted);
  if (!hosted || document.getElementById("burette-mesoscale-hosted-style")) return;
  const style = document.createElement("style");
  style.id = "burette-mesoscale-hosted-style";
  style.textContent = ".burette-mesoscale-hosted .msp-logo{display:none!important}";
  document.head.appendChild(style);
}

function installActionBridge(runtime: MesoscaleRuntimeApi) {
  window.addEventListener("message", (event) => {
    const envelope = event.data;
    if (envelope?.source === "burette-mesoscale-preview") {
      const preview = envelope as MesoscalePreviewMessage;
      const expectedDocumentId = window.BuretteConfig?.documentId;
      if (event.source === window.parent && preview.apiVersion === MESOSCALE_API_VERSION && preview.documentId === expectedDocumentId) {
        runtime.highlightObject(preview.ref, preview.sequence);
      }
      return;
    }
    if (envelope?.source === "burette-mesoscale-host") {
      const request = envelope as MesoscaleRequest;
      const expectedDocumentId = window.BuretteConfig?.documentId;
      const reply = (result: MesoscaleResult) => (event.source as Window | null)?.postMessage({
        source: "burette-mesoscale-runtime",
        apiVersion: MESOSCALE_API_VERSION,
        documentId: String(expectedDocumentId || ""),
        requestId: request.requestId,
        result,
      }, "*");
      if (event.source !== window.parent || request.apiVersion !== MESOSCALE_API_VERSION || request.documentId !== expectedDocumentId) {
        reply({ kind: "failure", code: "STALE_TARGET", message: "Mesoscale request target is stale or belongs to another document", revision: runtime.revision });
        return;
      }
      if (request.expectedRevision !== undefined && request.expectedRevision !== runtime.revision && request.action.type !== "getSummary" && request.action.type !== "getHierarchyPage") {
        reply({ kind: "failure", code: "REVISION_CONFLICT", message: "Mesoscale state changed before this action was applied", revision: runtime.revision });
        return;
      }
      void runtime.runV2(request.action).then(
        reply,
        (error) => reply({ kind: "failure", code: "MESOSCALE_ACTION_FAILED", message: String(error?.message || error), revision: runtime.revision }),
      );
      return;
    }
    if (envelope?.source === "burette-host" && envelope.body?.type === "setViewerTheme") {
      const theme = String(envelope.body.value || "auto") as MesoscaleConfig["theme"];
      if (window.BuretteConfig) window.BuretteConfig.theme = theme;
      applyViewerTheme(runtime, theme);
      return;
    }
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
  const uiMode = config.uiMode ?? "diagnostic";
  const hosted = uiMode === "hosted";
  const diagnostic = uiMode === "diagnostic";
  applyHostedUi(hosted);
  const explorer = await MesoscaleExplorer.create("app", {
    extensions: [],
    graphicsMode: config.graphicsMode ?? "balanced",
    layoutIsExpanded: false,
    layoutShowControls: diagnostic,
    layoutShowRemoteState: false,
    layoutShowSequence: false,
    layoutShowLog: diagnostic,
    viewportShowExpand: true,
    viewportShowControls: true,
    viewportShowSettings: true,
    viewportShowSelectionMode: true,
    viewportShowAnimation: true,
    viewportShowTrajectoryControls: false,
  });
  const runtime = new MesoscaleRuntimeApi(explorer);
  window.BuretteMesoscale = runtime;
  installActionBridge(runtime);
  applyViewerTheme(runtime, config.theme);
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => {
    if ((window.BuretteConfig?.theme ?? "auto") === "auto") applyViewerTheme(runtime, "auto");
  });
  await loadSource(runtime, config);
  explorer.handleResize();
  if (config.documentId && window.parent && window.parent !== window) {
    window.parent.postMessage({
      source: "burette-mesoscale-runtime",
      apiVersion: MESOSCALE_API_VERSION,
      documentId: config.documentId,
      result: runtime.sceneSummary(),
    }, "*");
  }
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
