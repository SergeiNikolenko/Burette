import { MesoscaleExplorer } from "molstar/lib/apps/mesoscale-explorer/app.js";
import { MesoFocusLoci } from "molstar/lib/apps/mesoscale-explorer/behavior/camera.js";
import { MesoscaleState, getAllEntities, getAllGroups, getEntities, getEntityDescription, getEntityLabel, getRoots, setGraphicsCanvas3DProps } from "molstar/lib/apps/mesoscale-explorer/data/state.js";
import { LoadModel, openState } from "molstar/lib/apps/mesoscale-explorer/ui/states.js";
import { PluginCommands } from "molstar/lib/mol-plugin/commands.js";
import { Structure, StructureElement, StructureProperties } from "molstar/lib/mol-model/structure.js";
import { OrderedSet } from "molstar/lib/mol-data/int.js";
import type { UnitIndex } from "molstar/lib/mol-model/structure/structure/element/util.js";
import { EveryLoci, Loci } from "molstar/lib/mol-model/loci.js";
import { Sphere3D } from "molstar/lib/mol-math/geometry.js";
import { Mat4, Vec2, Vec3 } from "molstar/lib/mol-math/linear-algebra.js";
import { PluginStateSnapshotManager } from "molstar/lib/mol-plugin-state/manager/snapshots.js";
import { StateSelection } from "molstar/lib/mol-state/index.js";
import { Asset } from "molstar/lib/mol-util/assets.js";
import { Unzip } from "molstar/lib/mol-util/zip/zip.js";
import { Color } from "molstar/lib/mol-util/color/index.js";
import { Binding } from "molstar/lib/mol-util/binding.js";
import { MarkerAction } from "molstar/lib/mol-util/marker-action.js";
import { createMesoscaleCanvasInteractionController, shouldClearMesoscaleSelectionOnMiss, type MesoscaleCanvasPoint } from "./mesoscale-canvas-interaction";
import { installMesoscalePanelResizeHandles } from "./mesoscale-panel-resize";
import { mesoscaleZipEntries, validateGenericMesoscaleManifest, validateMesoscaleArchiveEntries } from "./mesoscale-package";
import {
  MESOSCALE_API_VERSION,
  MESOSCALE_HIERARCHY_DETAIL_LIMIT,
  MESOSCALE_HIERARCHY_DETAIL_PER_OBJECT_LIMIT,
  MESOSCALE_HIERARCHY_PAGE_LIMIT,
  MESOSCALE_SELECTION_BATCH_LIMIT,
  MESOSCALE_SELECTION_REF_LIMIT,
  type MesoscaleAction,
  type MesoscaleChromeMessage,
  type MesoscaleControlPlacement,
  type MesoscaleGraphicsMode,
  type MesoscaleHierarchyDetail,
  type MesoscaleClipShape,
  type MesoscaleHierarchySelector,
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

function structureUnitSelector(source: Structure, unit: Structure["units"][number]): MesoscaleHierarchySelector {
  const location = StructureElement.Location.create(source);
  location.unit = unit;
  location.element = unit.elements[0];
  return {
    model: String(unit.model.modelNum || unit.model.id || "1").slice(0, 128),
    chain: String(StructureProperties.chain.auth_asym_id(location) || StructureProperties.chain.label_asym_id(location) || unit.chainGroupId).slice(0, 128),
    operator: String(unit.conformation.operator.name || "1_555").slice(0, 128),
  };
}

function hierarchyDetailId(selector: MesoscaleHierarchySelector) {
  return `model:${selector.model}:chain:${selector.chain}:operator:${selector.operator}`;
}

function selectedDetailKey(ref: string, id: string) {
  return JSON.stringify([ref, id]);
}

function parseHierarchyDetailId(id: string): MesoscaleHierarchySelector | null {
  const match = /^model:(.*):chain:(.*):operator:(.*)$/.exec(id);
  return match ? { model: match[1], chain: match[2], operator: match[3] } : null;
}

const MESOSCALE_HISTORY_LIMIT = 50;

const MESOSCALE_UNDOABLE_ACTIONS = new Set<MesoscaleAction["type"]>([
  "setGraphics", "setSelection", "setSelectionBatch", "setDetailSelection", "setDetailSelectionBatch",
  "setSelectionStyle", "setSelectionVisibility", "isolateSelection", "setIllumination", "setMotion",
  "focusObject", "focusDetail", "setVisibility", "isolateObjects", "setStyle", "setClip",
  "resetCamera", "orientAxes", "resetAxes", "applySnapshot",
]);

type MesoscaleSceneState = {
  entities: { ref: string; color: number | null; opacity: number; emissive: number; hidden: boolean; clipObjects: unknown[] }[];
  groups: { ref: string; hidden: boolean }[];
  selectedRefs: string[];
  selectedDetails: { ref: string; id: string }[];
  camera: unknown;
  graphics: string | null;
  motion: MesoscaleMotion;
  illumination: boolean;
};

function structureHierarchy(source: Structure, budget: { remaining: number }) {
  const models = new Map<string, { elements: number; chains: Map<string, { elements: number; operators: Map<string, number> }> }>();
  for (const unit of source.units) {
    if (unit.elements.length === 0) continue;
    const { model: modelLabel, chain: chainLabel, operator: operatorLabel } = structureUnitSelector(source, unit);
    const elementCount = unit.elements.length;
    const model = models.get(modelLabel) ?? { elements: 0, chains: new Map() };
    const chain = model.chains.get(chainLabel) ?? { elements: 0, operators: new Map() };
    model.elements += elementCount;
    chain.elements += elementCount;
    chain.operators.set(operatorLabel, (chain.operators.get(operatorLabel) ?? 0) + elementCount);
    model.chains.set(chainLabel, chain);
    models.set(modelLabel, model);
  }
  let localRemaining = Math.min(MESOSCALE_HIERARCHY_DETAIL_PER_OBJECT_LIMIT, budget.remaining);
  const details: MesoscaleHierarchyDetail[] = [];
  for (const [modelLabel, model] of models) {
    if (localRemaining <= 0 || budget.remaining <= 0) break;
    localRemaining -= 1;
    budget.remaining -= 1;
    const modelDetail: MesoscaleHierarchyDetail = {
      id: `model:${modelLabel}`,
      label: `Model ${modelLabel}`,
      detail: `${model.elements.toLocaleString()} elements`,
      childCount: model.chains.size,
      children: [],
    };
    for (const [chainLabel, chain] of model.chains) {
      if (localRemaining <= 0 || budget.remaining <= 0) break;
      localRemaining -= 1;
      budget.remaining -= 1;
      const operatorEntries = Array.from(chain.operators);
      const operatorChildCount = operatorEntries.length > 0 ? 1 : 0;
      const chainDetail: MesoscaleHierarchyDetail = {
        id: `model:${modelLabel}:chain:${chainLabel}`,
        label: `Chain ${chainLabel}`,
        detail: `${chain.elements.toLocaleString()} elements`,
        childCount: operatorChildCount,
        children: [],
      };
      if (operatorEntries.length > 0 && localRemaining > 0 && budget.remaining > 0) {
        localRemaining -= 1;
        budget.remaining -= 1;
        const operatorDetail: MesoscaleHierarchyDetail = {
          id: `model:${modelLabel}:chain:${chainLabel}:operators`,
          label: "Operators",
          detail: `${operatorEntries.length.toLocaleString()} ${operatorEntries.length === 1 ? "instance" : "instances"}`,
          childCount: operatorEntries.length,
          children: [],
        };
        for (const [operatorLabel, elements] of operatorEntries) {
          if (localRemaining <= 0 || budget.remaining <= 0) break;
          localRemaining -= 1;
          budget.remaining -= 1;
          operatorDetail.children?.push({
            id: hierarchyDetailId({ model: modelLabel, chain: chainLabel, operator: operatorLabel }),
            label: `Operator ${operatorLabel}`,
            detail: `${elements.toLocaleString()} elements`,
            selector: { model: modelLabel, chain: chainLabel, operator: operatorLabel },
            children: [],
          });
        }
        operatorDetail.childrenTruncated = (operatorDetail.children?.length ?? 0) < operatorEntries.length;
        chainDetail.children?.push(operatorDetail);
      }
      chainDetail.childrenTruncated = (chainDetail.children?.length ?? 0) < operatorChildCount;
      modelDetail.children?.push(chainDetail);
    }
    modelDetail.childrenTruncated = (modelDetail.children?.length ?? 0) < model.chains.size;
    details.push(modelDetail);
  }
  return { children: details, childCount: models.size, childrenTruncated: details.length < models.size };
}

function entitySummary(plugin: MesoscaleExplorer["plugin"], cell: any, parentRef?: string | null, detailBudget?: { remaining: number }) {
  const source = cell?.obj?.data?.sourceData;
  const isStructure = source instanceof Structure;
  const params = cell?.transform?.params || {};
  const typeParams = params.type?.params || params;
  const colorTheme = params.colorTheme;
  const color = colorTheme?.name === "illustrative"
    ? colorTheme?.params?.style?.params?.value
    : colorTheme?.params?.value ?? params.coloring?.params?.color;
  const hierarchy = isStructure && detailBudget ? structureHierarchy(source, detailBudget) : null;
  return {
    ref: String(cell?.transform?.ref || ""),
    parentRef: parentRef === undefined ? String(cell?.transform?.parent || "") || null : parentRef,
    label: getEntityLabel(plugin, cell),
    description: getEntityDescription(plugin, cell),
    hidden: Boolean(cell?.state?.isHidden),
    kind: (isStructure ? "structure" : "mesh") as "structure" | "mesh",
    elementCount: isStructure ? Number(source.elementCount || 0) : 0,
    instanceCount: isStructure ? Math.max(1, Number(source.units?.length || 1)) : Number(cell?.obj?.data?.repr?.renderObjects?.length || 1),
    color: Number.isInteger(color) ? Number(color) : null,
    opacity: Number.isFinite(typeParams.alpha) ? Number(typeParams.alpha) : 1,
    emissive: Number.isFinite(typeParams.emissive) ? Number(typeParams.emissive) : 0,
    ...(hierarchy ?? {}),
  };
}

function entityGroupParentRef(plugin: MesoscaleExplorer["plugin"], cell: any, groups: any[]) {
  const entityRef = String(cell?.transform?.ref || "");
  for (const group of groups) {
    const tag = String(group?.params?.values?.tag || "");
    if (!tag) continue;
    if (uniqueCells(getEntities(plugin, tag)).some((candidate: any) => String(candidate?.transform?.ref || "") === entityRef)) {
      return String(group?.transform?.ref || "") || null;
    }
  }
  return null;
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
  selectionVersion = 0;
  private selectionMutationDepth = 0;
  readonly selectedRefs = new Set<string>();
  readonly selectedDetails = new Map<string, { ref: string; id: string }>();
  readonly visibilityOverrides = new Map<string, boolean>();
  readonly layoutRegions: Record<MesoscaleLayoutRegion, boolean> = { left: false, right: false };
  motion: MesoscaleMotion = "off";
  previewSequence = 0;
  hoverAppearanceActive = false;
  hoverDimming = true;
  readonly undoStack: MesoscaleSceneState[] = [];
  readonly redoStack: MesoscaleSceneState[] = [];

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
    const entitySummaries = entities.map((cell: any) => entitySummary(this.plugin, cell, entityGroupParentRef(this.plugin, cell, allGroups)));
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
    const selectedRefs = Array.from(this.selectedRefs).slice(0, MAX_OBSERVED_ITEMS);
    const selectedDetails = Array.from(this.selectedDetails.values()).slice(0, MAX_OBSERVED_ITEMS);
    const selectedCount = this.selectedRefs.size + this.selectedDetails.size;
    const hierarchyPreview = [
      ...observed.groups.map((item: ReturnType<typeof groupSummary>) => ({
        ...item,
        hidden: this.visibilityOverrides.get(item.ref) ?? item.hidden,
        kind: "group" as const,
        selected: this.selectedRefs.has(item.ref),
        elementCount: 0,
        instanceCount: 0,
        color: null,
        opacity: null,
        emissive: null,
        children: [],
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
      selectedRefs,
      selectedDetails,
      selectedCount,
      selectionTruncated: selectedRefs.length + selectedDetails.length < selectedCount,
      selectionVersion: this.selectionVersion,
      selectionMode: Boolean(this.plugin.selectionMode),
      illumination: Boolean(this.plugin.canvas3d?.props.illumination.enabled),
      hoverDimming: this.hoverDimming,
      history: { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 },
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
        color: null,
        opacity: null,
        emissive: null,
        children: [],
      };
    });
    const allGroups = uniqueCells(getAllGroups(this.plugin));
    const entityCells = uniqueCells(getAllEntities(this.plugin)) as any[];
    const entityCellByRef = new Map(entityCells.map((cell: any) => [String(cell?.transform?.ref || ""), cell]));
    const entities: MesoscaleHierarchyObject[] = entityCells.map((cell: any) => {
      const summary = entitySummary(this.plugin, cell, entityGroupParentRef(this.plugin, cell, allGroups));
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
    const detailBudget = { remaining: MESOSCALE_HIERARCHY_DETAIL_LIMIT };
    const items = all.slice(start, start + limit).map((item) => {
      if (item.kind !== "structure") return item;
      const cell = entityCellByRef.get(item.ref);
      if (!cell || detailBudget.remaining <= 0) return { ...item, childCount: Math.max(1, item.childCount ?? 0), childrenTruncated: true, children: [] };
      const summary = entitySummary(this.plugin, cell, item.parentRef, detailBudget);
      return {
        ...summary,
        hidden: this.visibilityOverrides.get(summary.ref) ?? summary.hidden,
        selected: this.selectedRefs.has(summary.ref),
      };
    });
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

  syncSelectedRefs() {
    const hadSelectedDetails = this.selectedDetails.size > 0;
    const next = new Set<string>();
    const selection = this.plugin.managers.structure.selection;
    for (const cell of uniqueCells(getAllEntities(this.plugin)) as any[]) {
      const structure = cell?.obj?.data?.sourceData;
      if (!(structure instanceof Structure)) continue;
      const loci = selection.getLoci(structure);
      if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) continue;
      const ref = String(cell?.transform?.ref || "");
      if (ref) next.add(ref);
    }
    if (!hadSelectedDetails && next.size === this.selectedRefs.size && Array.from(next).every((ref) => this.selectedRefs.has(ref))) return false;
    this.selectedDetails.clear();
    this.selectedRefs.clear();
    for (const ref of next) this.selectedRefs.add(ref);
    this.selectionVersion += 1;
    return true;
  }

  noteExternalSelectionChange() {
    this.changed();
  }

  // Undo restores a compact snapshot of everything this screen can change —
  // appearance, clipping, visibility, selection, camera and render settings —
  // rather than a full Mol* state snapshot, which would be far too heavy for a
  // mesoscale scene.
  captureSceneState(): MesoscaleSceneState {
    const entities = uniqueCells(getAllEntities(this.plugin)) as any[];
    return {
      entities: entities.map((cell) => {
        const summary = entitySummary(this.plugin, cell);
        const params = cell?.transform?.params || {};
        const typeParams = params.type?.params || params;
        return {
          ref: summary.ref,
          color: summary.color,
          opacity: summary.opacity,
          emissive: summary.emissive,
          hidden: Boolean(cell?.state?.isHidden),
          clipObjects: Array.isArray(typeParams.clip?.objects) ? [...typeParams.clip.objects] : [],
        };
      }),
      groups: (uniqueCells(getAllGroups(this.plugin)) as any[]).map((cell) => ({
        ref: String(cell?.transform?.ref || ""),
        hidden: Boolean(cell?.state?.isHidden),
      })),
      selectedRefs: Array.from(this.selectedRefs),
      selectedDetails: Array.from(this.selectedDetails.values()).map((detail) => ({ ...detail })),
      camera: this.plugin.canvas3d?.camera.getSnapshot(),
      graphics: (MesoscaleState.has(this.plugin) ? MesoscaleState.get(this.plugin).graphics : null) ?? null,
      motion: this.motion,
      illumination: Boolean(this.plugin.canvas3d?.props.illumination.enabled),
    };
  }

  private async applySceneState(state: MesoscaleSceneState) {
    const cells = new Map((uniqueCells(getAllEntities(this.plugin)) as any[]).map((cell) => [String(cell?.transform?.ref || ""), cell]));
    for (const entity of state.entities) {
      const cell = cells.get(entity.ref);
      if (!cell) continue;
      const current = entitySummary(this.plugin, cell);
      const params = cell?.transform?.params || {};
      const currentClip = Array.isArray((params.type?.params || params).clip?.objects) ? (params.type?.params || params).clip.objects : [];
      const values: Record<string, unknown> = {};
      if (current.color !== entity.color && entity.color !== null) values.color = entity.color;
      if (current.opacity !== entity.opacity) values.opacity = entity.opacity;
      if (current.emissive !== entity.emissive) values.emissive = entity.emissive;
      if (currentClip.length !== entity.clipObjects.length) values.clipObjects = entity.clipObjects;
      if (Object.keys(values).length > 0) await this.styleCells([cell], values);
      if (Boolean(cell?.state?.isHidden) !== entity.hidden) await this.setCellVisibility(cell, !entity.hidden);
    }
    const groupCells = new Map((uniqueCells(getAllGroups(this.plugin)) as any[]).map((cell) => [String(cell?.transform?.ref || ""), cell]));
    for (const group of state.groups) {
      const cell = groupCells.get(group.ref);
      if (cell && Boolean(cell?.state?.isHidden) !== group.hidden) await this.setCellVisibility(cell, !group.hidden);
    }
    this.selectionMutationDepth += 1;
    try {
      this.plugin.managers.interactivity.lociSelects.deselectAll();
      this.selectedRefs.clear();
      this.selectedDetails.clear();
      for (const ref of state.selectedRefs) {
        try { this.mutateSelection(ref, "extend"); } catch { /* the object left the scene */ }
      }
      for (const detail of state.selectedDetails) {
        const source = this.entity(detail.ref)?.obj?.data?.sourceData;
        if (!(source instanceof Structure)) continue;
        const selector = parseHierarchyDetailId(detail.id);
        if (!selector) continue;
        try {
          const target = this.detailTarget(detail.ref, selector);
          this.plugin.managers.interactivity.lociSelects.select({ loci: target.loci }, false);
          this.selectedDetails.set(selectedDetailKey(detail.ref, target.id), { ref: detail.ref, id: target.id });
        } catch { /* the operator left the scene */ }
      }
    } finally {
      this.selectionMutationDepth -= 1;
    }
    this.selectionVersion += 1;
    if (state.camera) this.plugin.canvas3d?.camera.setState(state.camera, 0);
    if (state.graphics) await this.setGraphics(state.graphics as GraphicsMode);
    if (state.motion !== this.motion) this.setMotion(state.motion);
    if (Boolean(this.plugin.canvas3d?.props.illumination.enabled) !== state.illumination) {
      this.plugin.canvas3d?.setProps({ illumination: { enabled: state.illumination } });
    }
    this.plugin.canvas3d?.requestDraw();
    this.changed();
  }

  pushHistory() {
    this.redoStack.length = 0;
    this.undoStack.push(this.captureSceneState());
    if (this.undoStack.length > MESOSCALE_HISTORY_LIMIT) this.undoStack.shift();
  }

  async undo() {
    const previous = this.undoStack.pop();
    if (!previous) throw new Error("Nothing to undo on this scene");
    this.redoStack.push(this.captureSceneState());
    await this.applySceneState(previous);
    return this.observe();
  }

  async redo() {
    const next = this.redoStack.pop();
    if (!next) throw new Error("Nothing to redo on this scene");
    this.undoStack.push(this.captureSceneState());
    await this.applySceneState(next);
    return this.observe();
  }

  async resetCamera() {
    this.plugin.managers.camera.reset(undefined, 250);
    this.changed();
    return this.observe();
  }

  async orientAxes() {
    this.plugin.managers.camera.orientAxes(undefined, 250);
    this.changed();
    return this.observe();
  }

  async resetAxes() {
    this.plugin.managers.camera.resetAxes(250);
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

  private objectEntities(ref: string) {
    const entity = uniqueCells(getAllEntities(this.plugin)).find((cell: any) => cell?.transform?.ref === ref);
    if (entity) return [entity];
    const groups = uniqueCells(getAllGroups(this.plugin)) as any[];
    const group = groups.find((cell: any) => cell?.transform?.ref === ref) as any;
    if (!group) throw new Error(`Mesoscale object not found: ${ref}`);
    const visited = new Set<string>();
    let current = group;
    while (current) {
      const currentRef = String(current?.transform?.ref || "");
      if (!currentRef || visited.has(currentRef)) break;
      visited.add(currentRef);
      const entities = uniqueCells(getAllEntities(this.plugin, String(current?.params?.values?.tag || "")));
      if (entities.length > 0) return entities;
      const parentRef = String(current?.transform?.parent || "");
      current = groups.find((candidate: any) => candidate?.transform?.ref === parentRef);
    }
    throw new Error(`Mesoscale group has no entities: ${ref}`);
  }

  private detailTarget(ref: string, selector: MesoscaleHierarchySelector) {
    if (!selector || typeof selector !== "object") throw new Error("Mesoscale detail selector is missing");
    const normalized = {
      model: String(selector.model || "").slice(0, 128),
      chain: String(selector.chain || "").slice(0, 128),
      operator: String(selector.operator || "").slice(0, 128),
    };
    if (!normalized.model || !normalized.chain || !normalized.operator) throw new Error("Mesoscale detail selector is invalid");
    const cell = this.entity(ref);
    const source = cell?.obj?.data?.sourceData;
    if (!(source instanceof Structure)) throw new Error(`Object is not selectable as a molecular structure: ${ref}`);
    const elements = source.units
      .filter((unit) => unit.elements.length > 0)
      .filter((unit) => {
        const identity = structureUnitSelector(source, unit);
        return identity.model === normalized.model && identity.chain === normalized.chain && identity.operator === normalized.operator;
      })
      .map((unit) => ({ unit, indices: OrderedSet.ofBounds(0, unit.elements.length) as OrderedSet<UnitIndex> }));
    if (elements.length === 0) throw new Error(`Mesoscale operator was not found: ${normalized.operator}`);
    return {
      id: hierarchyDetailId(normalized),
      loci: StructureElement.Loci(source, elements),
      repr: cell?.obj?.data?.repr,
    };
  }

  // Dimming belongs to hover alone: a resting scene keeps every structure in its own
  // color even while objects are selected, and only the pointer fades the rest away.
  // With dimming turned off the hovered structure is tinted instead, so hover stays
  // readable without washing out the scene.
  private setHoverAppearance(active: boolean) {
    this.hoverAppearanceActive = active;
    const dimmed = active && this.hoverDimming;
    this.plugin.canvas3d?.setProps({
      renderer: {
        dimColor: Color(0xffffff),
        dimStrength: dimmed ? 1 : 0,
        highlightStrength: active && !this.hoverDimming ? 0.45 : 0,
        markerPriority: active ? 1 : 2,
        selectColor: Color(0xffffff),
        selectStrength: dimmed ? 1 : 0,
      },
    });
  }

  setHoverDimming(enabled: boolean) {
    this.hoverDimming = enabled;
    this.setHoverAppearance(this.hoverAppearanceActive);
    this.changed();
    return this.observe();
  }

  highlightObject(ref: string | null, sequence: number, selector?: MesoscaleHierarchySelector) {
    if (sequence < this.previewSequence) return;
    this.previewSequence = sequence;
    const canvas = this.plugin.canvas3d;
    canvas?.mark({ loci: EveryLoci }, MarkerAction.RemoveHighlight);
    if (!ref) {
      this.setHoverAppearance(false);
      return;
    }
    this.setHoverAppearance(true);
    if (selector) {
      try {
        const target = this.detailTarget(ref, selector);
        canvas?.mark({ repr: target.repr, loci: target.loci }, MarkerAction.Highlight);
      } catch { /* stale hierarchy detail after a scene update */ }
      return;
    }
    let entities: any[] = [];
    try { entities = this.objectEntities(ref); } catch { /* empty organizational group */ }
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

  private async setCellVisibility(cell: any, visible: boolean) {
    const ref = String(cell?.transform?.ref || "");
    if (!cell) throw new Error(`Mesoscale object not found: ${ref}`);
    if (!cell.parent) throw new Error(`Mesoscale object has no state owner: ${ref}`);
    if (Boolean(cell.state?.isHidden) === visible) {
      await PluginCommands.State.ToggleVisibility(this.plugin, { state: cell.parent, ref });
    }
    this.visibilityOverrides.set(ref, !visible);
  }

  async setVisibility(ref: string, visible: boolean) {
    const cell = [...uniqueCells(getAllGroups(this.plugin)), ...uniqueCells(getAllEntities(this.plugin))]
      .find((candidate: any) => candidate?.transform?.ref === ref);
    if (!cell) throw new Error(`Mesoscale object not found: ${ref}`);
    await this.setCellVisibility(cell, visible);
    this.changed();
    return this.observe();
  }

  private mutateSelection(ref: string, mode: "replace" | "extend" | "toggle" = "replace") {
    const cells = this.objectEntities(ref).filter((cell: any) => cell?.obj?.data?.sourceData instanceof Structure) as any[];
    if (cells.length === 0) throw new Error(`Object is not selectable as a molecular structure: ${ref}`);
    const selection = this.plugin.managers.interactivity.lociSelects;
    const before = new Set(this.selectedRefs);
    this.selectionMutationDepth += 1;
    try {
      if (mode === "replace") {
        selection.deselectAll();
        this.selectedRefs.clear();
        this.selectedDetails.clear();
      }
      for (const cell of cells) {
        const loci = Structure.toStructureElementLoci(cell.obj.data.sourceData);
        const entityRef = String(cell?.transform?.ref || "");
        if (mode === "toggle") {
          selection.toggle({ loci }, false);
          if (this.selectedRefs.has(entityRef)) this.selectedRefs.delete(entityRef);
          else if (entityRef) {
            for (const [key, detail] of this.selectedDetails) if (detail.ref === entityRef) this.selectedDetails.delete(key);
            this.selectedRefs.add(entityRef);
          }
        } else {
          selection.select({ loci }, false);
          if (entityRef) {
            for (const [key, detail] of this.selectedDetails) if (detail.ref === entityRef) this.selectedDetails.delete(key);
            this.selectedRefs.add(entityRef);
          }
        }
      }
    } finally {
      this.selectionMutationDepth -= 1;
    }
    if (before.size !== this.selectedRefs.size || Array.from(before).some((entityRef) => !this.selectedRefs.has(entityRef))) {
      this.selectionVersion += 1;
    }
  }

  selectEntityInteractive(ref: string, mode: "replace" | "extend" | "toggle" = "replace") {
    this.mutateSelection(ref, mode);
    this.changed();
  }

  async selectEntity(ref: string, mode: "replace" | "extend" | "toggle" = "replace") {
    this.mutateSelection(ref, mode);
    this.changed();
    return this.observe();
  }

  async selectDetail(ref: string, selector: MesoscaleHierarchySelector, mode: "replace" | "extend" | "toggle" = "replace") {
    const target = this.detailTarget(ref, selector);
    const key = selectedDetailKey(ref, target.id);
    const selection = this.plugin.managers.interactivity.lociSelects;
    const beforeCount = this.selectedRefs.size + this.selectedDetails.size;
    this.selectionMutationDepth += 1;
    try {
      if (mode === "replace") {
        selection.deselectAll();
        this.selectedRefs.clear();
        this.selectedDetails.clear();
      }
      if (mode === "toggle") {
        selection.toggle({ loci: target.loci }, false);
        if (this.selectedDetails.has(key)) this.selectedDetails.delete(key);
        else this.selectedDetails.set(key, { ref, id: target.id });
      } else {
        selection.select({ loci: target.loci }, false);
        this.selectedDetails.set(key, { ref, id: target.id });
      }
    } finally {
      this.selectionMutationDepth -= 1;
    }
    if (beforeCount !== this.selectedRefs.size + this.selectedDetails.size || mode === "replace" || mode === "toggle") this.selectionVersion += 1;
    this.changed();
    return this.observe();
  }

  async selectDetails(ref: string, selectors: MesoscaleHierarchySelector[], mode: "replace" | "extend" = "replace") {
    if (!Array.isArray(selectors) || selectors.length === 0) throw new Error("At least one Mesoscale operator is required for selection");
    if (selectors.length > MESOSCALE_SELECTION_BATCH_LIMIT) throw new Error(`Selection batch exceeds ${MESOSCALE_SELECTION_BATCH_LIMIT} operators`);
    const targets = selectors.map((selector) => this.detailTarget(ref, selector));
    const selection = this.plugin.managers.interactivity.lociSelects;
    this.selectionMutationDepth += 1;
    try {
      if (mode === "replace") {
        selection.deselectAll();
        this.selectedRefs.clear();
        this.selectedDetails.clear();
      }
      for (const target of targets) {
        selection.select({ loci: target.loci }, false);
        this.selectedDetails.set(selectedDetailKey(ref, target.id), { ref, id: target.id });
      }
    } finally {
      this.selectionMutationDepth -= 1;
    }
    this.selectionVersion += 1;
    this.changed();
    return this.observe();
  }

  async selectEntities(refs: string[], mode: "replace" | "extend" = "replace") {
    if (!Array.isArray(refs) || refs.length === 0) throw new Error("At least one Mesoscale object is required for selection");
    if (refs.length > MESOSCALE_SELECTION_BATCH_LIMIT) throw new Error(`Selection batch exceeds ${MESOSCALE_SELECTION_BATCH_LIMIT} objects`);
    if (refs.some((ref) => typeof ref !== "string" || ref.length === 0 || ref.length > MESOSCALE_SELECTION_REF_LIMIT)) throw new Error("Selection batch contains an invalid object reference");
    const boundedRefs = Array.from(new Set(refs));
    const cells = uniqueCells(boundedRefs.flatMap((ref) => this.objectEntities(ref)))
      .filter((cell: any) => cell?.obj?.data?.sourceData instanceof Structure) as any[];
    if (cells.length === 0) throw new Error("No selectable molecular structures were found");
    const before = new Set(this.selectedRefs);
    const selection = this.plugin.managers.interactivity.lociSelects;
    this.selectionMutationDepth += 1;
    try {
      if (mode === "replace") {
        selection.deselectAll();
        this.selectedRefs.clear();
        this.selectedDetails.clear();
      }
      for (const cell of cells) {
        selection.select({ loci: Structure.toStructureElementLoci(cell.obj.data.sourceData) }, false);
        const ref = String(cell?.transform?.ref || "");
        if (ref) {
          for (const [key, detail] of this.selectedDetails) if (detail.ref === ref) this.selectedDetails.delete(key);
          this.selectedRefs.add(ref);
        }
      }
    } finally {
      this.selectionMutationDepth -= 1;
    }
    if (before.size !== this.selectedRefs.size || Array.from(before).some((ref) => !this.selectedRefs.has(ref))) this.selectionVersion += 1;
    this.changed();
    return this.observe();
  }

  pickEntityRef(point: MesoscaleCanvasPoint) {
    const canvas = this.plugin.canvas3d;
    if (!canvas) return null;
    const pick = canvas.identify(Vec2.create(point.x, point.y));
    if (!pick) return null;
    const current = canvas.getLoci(pick.id);
    const pickedStructure = StructureElement.Loci.is(current.loci)
      ? current.loci.structure
      : current.loci.kind === "structure-loci" ? current.loci.structure : null;
    const cell = uniqueCells(getAllEntities(this.plugin)).find((candidate: any) => {
      const candidateRepresentation = candidate?.obj?.data?.repr;
      return candidate?.obj?.data?.sourceData instanceof Structure
      && (candidateRepresentation === current.repr
        || candidateRepresentation?.renderObjects?.some((renderObject: any) => renderObject?.id === pick.id.objectId)
        || Boolean(pickedStructure && (
          candidate.obj.data.sourceData === pickedStructure
          || Structure.areEquivalent(candidate.obj.data.sourceData, pickedStructure)
        )));
    });
    return cell ? String(cell.transform.ref || "") || null : null;
  }

  canvasItem(ref: string): MesoscaleHierarchyObject | null {
    const allGroups = uniqueCells(getAllGroups(this.plugin));
    const cell = uniqueCells(getAllEntities(this.plugin)).find((candidate: any) => candidate?.transform?.ref === ref);
    if (!cell) return null;
    const summary = entitySummary(this.plugin, cell, entityGroupParentRef(this.plugin, cell, allGroups));
    return {
      ...summary,
      hidden: this.visibilityOverrides.get(summary.ref) ?? summary.hidden,
      selected: this.selectedRefs.has(summary.ref),
    };
  }

  clearSelection() {
    this.selectionMutationDepth += 1;
    try {
      this.plugin.managers.interactivity.lociSelects.deselectAll();
    } finally {
      this.selectionMutationDepth -= 1;
    }
    if (this.selectedRefs.size > 0 || this.selectedDetails.size > 0) this.selectionVersion += 1;
    this.selectedRefs.clear();
    this.selectedDetails.clear();
    this.changed();
    return this.observe();
  }

  get ownsSelectionMutation() {
    return this.selectionMutationDepth > 0;
  }

  async focusEntity(ref: string) {
    const cells = this.objectEntities(ref).filter((cell: any) => cell?.obj?.data?.sourceData instanceof Structure) as any[];
    if (cells.length === 0) throw new Error(`Object has no molecular focus target: ${ref}`);
    let sphere = Sphere3D();
    let hasSphere = false;
    for (const cell of cells) {
      const loci = Structure.toStructureElementLoci(cell.obj.data.sourceData);
      const next = Loci.getBoundingSphere(loci);
      if (!next) continue;
      sphere = hasSphere ? Sphere3D.expandBySphere(Sphere3D(), sphere, next) : Sphere3D.clone(next);
      hasSphere = true;
    }
    if (!hasSphere) throw new Error(`Object has no molecular focus target: ${ref}`);
    this.plugin.managers.camera.focusSphere(sphere, { durationMs: 250 });
    await MesoscaleState.set(this.plugin, { focusInfo: cells.length === 1 ? getEntityDescription(this.plugin, cells[0]) : `${cells.length} entities` });
    this.changed();
    return this.observe();
  }

  async focusDetail(ref: string, selector: MesoscaleHierarchySelector) {
    const target = this.detailTarget(ref, selector);
    const sphere = Loci.getBoundingSphere(target.loci);
    if (!sphere) throw new Error(`Mesoscale operator has no molecular focus target: ${selector.operator}`);
    this.plugin.managers.camera.focusSphere(sphere, { durationMs: 250 });
    await MesoscaleState.set(this.plugin, { focusInfo: `Operator ${selector.operator}` });
    this.changed();
    return this.observe();
  }

  private async styleCells(cells: any[], values: Record<string, unknown>) {
    const opacity = values.opacity === undefined ? undefined : Math.min(1, Math.max(0, Number(values.opacity)));
    const emissive = values.emissive === undefined ? undefined : Math.min(1, Math.max(0, Number(values.emissive)));
    const color = values.color === undefined ? undefined : Number(values.color);
    const clipObjects = Array.isArray(values.clipObjects) ? values.clipObjects.slice(0, 6) : undefined;
    for (const cell of cells) {
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
        if (clipObjects) params.clip = { ...(params.clip || {}), objects: clipObjects };
      }).commit();
      this.changed();
    }
  }

  async styleEntity(ref: string, values: Record<string, unknown>) {
    await this.styleCells(this.objectEntities(ref), values);
    await MesoscaleState.set(this.plugin, { graphics: "custom" });
    return this.observe();
  }

  // A clip shape is placed against the scene's own bounds, the way the upstream
  // Mesoscale clip control does, so the menu only has to name the shape.
  async setClip(ref: string, shape: MesoscaleClipShape, invert = false) {
    const bounds = this.plugin.canvas3d?.boundingSphere;
    if (shape !== "none" && !bounds) throw new Error("Mesoscale scene bounds are unavailable for clipping");
    // Upstream's default shape spans the whole scene, which cuts nothing; half the
    // bounds gives a visible cut the moment the shape is picked.
    const size = bounds ? bounds.radius : 0;
    const clipObjects = shape === "none" ? [] : [{
      type: shape,
      invert,
      position: Vec3.clone(bounds!.center),
      scale: Vec3.create(size, size, size),
      rotation: { axis: Vec3.create(0, 1, 0), angle: 0 },
      transform: Mat4.identity(),
    }];
    await this.styleCells(this.objectEntities(ref), { clipObjects });
    return this.observe();
  }

  async styleSelection(values: Record<string, unknown>) {
    if (Number.isFinite(values.selectionVersion) && Number(values.selectionVersion) !== this.selectionVersion) {
      throw new Error("Mesoscale selection changed before appearance was applied");
    }
    if (this.selectedRefs.size === 0) throw new Error("No Mesoscale structures are selected");
    const cells = uniqueCells(Array.from(this.selectedRefs).flatMap((ref) => this.objectEntities(ref)));
    await this.styleCells(cells, values);
    await MesoscaleState.set(this.plugin, { graphics: "custom" });
    return this.observe();
  }

  async setSelectionVisibility(visible: boolean) {
    if (this.selectedRefs.size === 0) throw new Error("No Mesoscale structures are selected");
    const cells = uniqueCells(Array.from(this.selectedRefs).flatMap((ref) => this.objectEntities(ref)));
    for (const cell of cells) {
      await this.setCellVisibility(cell, visible);
      this.changed();
    }
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
    applyBuretteSelectionAppearance(this);
    this.selectedRefs.clear();
    this.syncSelectedRefs();
    this.selectionVersion += 1;
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
      this.changed();
    }
    return this.observe();
  }

  async isolateSelection() {
    if (this.selectedRefs.size === 0) throw new Error("No Mesoscale structures are selected");
    const requested = new Set(this.selectedRefs);
    const cells = [...uniqueCells(getAllGroups(this.plugin)), ...uniqueCells(getAllEntities(this.plugin))];
    for (const cell of cells as any[]) {
      const visible = this.isUnderRef(cell, requested);
      if (!cell?.parent || Boolean(cell.state?.isHidden) !== visible) continue;
      await PluginCommands.State.ToggleVisibility(this.plugin, { state: cell.parent, ref: cell.transform.ref });
      this.visibilityOverrides.set(String(cell.transform.ref), !visible);
      this.changed();
    }
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
    // Everything that changes what the scene looks like records a restore point
    // first, so one Cmd+Z steps back through the same actions the UI performs.
    if (MESOSCALE_UNDOABLE_ACTIONS.has(action.type)) this.pushHistory();
    switch (action.type) {
      case "undo": await this.undo(); return this.sceneSummary();
      case "redo": await this.redo(); return this.sceneSummary();
      case "getSummary": return this.sceneSummary();
      case "getHierarchyPage": return this.hierarchyPage(action.filter, action.cursor, action.limit);
      case "setGraphics": await this.setGraphics(action.graphics); return this.sceneSummary();
      case "setFilter": await this.setFilter(action.filter); return this.sceneSummary();
      case "setSelection":
        if (action.mode === "clear" || !action.ref) this.clearSelection();
        else await this.selectEntity(action.ref, action.mode ?? "replace");
        return this.sceneSummary();
      case "setSelectionBatch": await this.selectEntities(action.refs, action.mode ?? "replace"); return this.sceneSummary();
      case "setDetailSelection": await this.selectDetail(action.ref, action.selector, action.mode ?? "replace"); return this.sceneSummary();
      case "setDetailSelectionBatch": await this.selectDetails(action.ref, action.selectors, action.mode ?? "replace"); return this.sceneSummary();
      case "setHoverDimming": this.setHoverDimming(action.enabled); return this.sceneSummary();
      case "setClip": await this.setClip(action.ref, action.shape, action.invert); return this.sceneSummary();
      case "setSelectionStyle": await this.styleSelection(action); return this.sceneSummary();
      case "setSelectionVisibility": await this.setSelectionVisibility(action.visible); return this.sceneSummary();
      case "isolateSelection": await this.isolateSelection(); return this.sceneSummary();
      case "setSelectionMode": this.setSelectionMode(action.enabled); return this.sceneSummary();
      case "setIllumination": this.setIllumination(action.enabled); return this.sceneSummary();
      case "setLayoutRegion": await this.setLayoutRegion(action.region, action.visible); return this.sceneSummary();
      case "setMotion": this.setMotion(action.motion); return this.sceneSummary();
      case "focusObject": await this.focusEntity(action.ref); return this.sceneSummary();
      case "focusDetail": await this.focusDetail(action.ref, action.selector); return this.sceneSummary();
      case "setVisibility": await this.setVisibility(action.ref, action.visible); return this.sceneSummary();
      case "isolateObjects": await this.isolateObjects(action.refs); return this.sceneSummary();
      case "setStyle": await this.styleEntity(action.ref, action); return this.sceneSummary();
      case "resetCamera": await this.resetCamera(); return this.sceneSummary();
      case "orientAxes": await this.orientAxes(); return this.sceneSummary();
      case "resetAxes": await this.resetAxes(); return this.sceneSummary();
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
        actions: ["getSummary", "getHierarchyPage", "setGraphics", "setFilter", "setSelection", "setSelectionBatch", "setDetailSelection", "setDetailSelectionBatch", "setHoverDimming", "setClip", "undo", "redo", "setSelectionStyle", "setSelectionVisibility", "isolateSelection", "setSelectionMode", "setIllumination", "setLayoutRegion", "setMotion", "focusObject", "focusDetail", "setVisibility", "isolateObjects", "setStyle", "resetCamera", "orientAxes", "resetAxes", "createSnapshot", "applySnapshot", "deleteSnapshot", "exportState", "exportPng", "getCapabilities"],
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

function applyBuretteSelectionAppearance(runtime: MesoscaleRuntimeApi) {
  runtime.plugin.canvas3d?.setProps({
    renderer: {
      colorMarker: true,
      highlightColor: Color(0xffffff),
      highlightStrength: 0,
      selectColor: Color(0xffffff),
      selectStrength: 0,
      dimColor: Color(0xffffff),
      dimStrength: 1,
      markerPriority: 2,
    },
    marking: {
      enabled: true,
      highlightEdgeColor: Color(0xaf52de),
      selectEdgeColor: Color(0xaf52de),
      highlightEdgeStrength: 1,
      selectEdgeStrength: 0.85,
      ghostEdgeStrength: 0.25,
      innerEdgeFactor: 1.2,
      edgeScale: 1,
    },
  });
}

// Scene state the host did not ask for — a panel closed by dragging its divider,
// for example — still has to reach the toolbar so its toggles stay truthful.
function postSceneSummary(runtime: MesoscaleRuntimeApi, documentId: string | undefined) {
  if (!documentId || !window.parent || window.parent === window) return;
  window.parent.postMessage({
    source: "burette-mesoscale-runtime",
    apiVersion: MESOSCALE_API_VERSION,
    documentId,
    result: runtime.sceneSummary(),
  }, "*");
}

function installBuretteSelectionAppearanceGuard(runtime: MesoscaleRuntimeApi) {
  return runtime.plugin.behaviors.interaction.keyReleased.subscribe(({ code }) => {
    if (!code.startsWith("Shift") && !code.startsWith("Control")) return;
    queueMicrotask(() => {
      const canvas = runtime.plugin.canvas3d;
      const dimStrength = runtime.hoverAppearanceActive ? 1 : 0;
      if (!canvas || canvas.props.renderer.dimStrength === dimStrength) return;
      canvas.setProps({ renderer: { dimStrength } });
    });
  });
}

function installBuretteSceneHover(runtime: MesoscaleRuntimeApi) {
  const subscription = runtime.plugin.behaviors.interaction.hover.subscribe(({ current }) => {
    const canvas = runtime.plugin.canvas3d;
    if (!canvas) return;
    canvas.mark({ loci: EveryLoci }, MarkerAction.RemoveHighlight);
    if (Loci.isEmpty(current.loci) || !current.repr) {
      runtime.highlightObject(null, runtime.previewSequence + 1);
      return;
    }
    runtime.previewSequence += 1;
    runtime["setHoverAppearance"](true);
    canvas.mark({ repr: current.repr, loci: EveryLoci }, MarkerAction.Highlight);
  });
  return () => subscription.unsubscribe();
}

function applyHostedUi(hosted: boolean) {
  document.body?.classList.toggle("burette-mesoscale-hosted", hosted);
  if (!hosted || document.getElementById("burette-mesoscale-hosted-style")) return;
  const style = document.createElement("style");
  style.id = "burette-mesoscale-hosted-style";
  const hostOwnedSelectors = [".burette-mesoscale-hosted .msp-logo"];
  if (window.parent !== window) hostOwnedSelectors.push(".burette-mesoscale-hosted .msp-selection-viewport-controls");
  style.textContent = `${hostOwnedSelectors.join(",")}{display:none!important}`;
  document.head.appendChild(style);
}

async function applyHostedInteractionBindings(runtime: MesoscaleRuntimeApi, hosted: boolean) {
  if (!hosted) return;
  const behaviors = runtime.plugin.state.behaviors.select(StateSelection.Generators.ofTransformer(MesoFocusLoci));
  for (const behavior of behaviors) {
    await runtime.plugin.state.behaviors.build().to(behavior).update((params: any) => {
      params.bindings = { ...params.bindings, clickCenterFocus: Binding.Empty };
    }).commit();
  }
}

function applyControlPlacement(placement: MesoscaleControlPlacement) {
  document.body?.classList.add("burette-mesoscale-owned-chrome");
  const controls = document.querySelector<HTMLElement>(".msp-viewport-controls");
  if (!controls) return;
  controls.classList.add("burette-mesoscale-controls-hidden");
  controls.dataset.buretteHostVisible = placement.visible ? "1" : "0";
}

function postCanvasInteraction(runtime: MesoscaleRuntimeApi, message: Record<string, unknown>) {
  const documentId = window.BuretteConfig?.documentId;
  if (!documentId || !window.parent || window.parent === window) return;
  window.parent.postMessage({
    source: "burette-mesoscale-interaction",
    apiVersion: MESOSCALE_API_VERSION,
    documentId,
    ...message,
  }, "*");
}

function installMesoscaleSelectionSync(runtime: MesoscaleRuntimeApi) {
  let queued = false;
  const subscription = runtime.plugin.managers.structure.selection.events.changed.subscribe(() => {
    if (runtime.ownsSelectionMutation) return;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!runtime.syncSelectedRefs()) return;
      runtime.noteExternalSelectionChange();
      postCanvasInteraction(runtime, { kind: "selection", summary: runtime.sceneSummary() });
    });
  });
  return () => subscription.unsubscribe();
}

function installMesoscaleCanvasInteractions(runtime: MesoscaleRuntimeApi) {
  const canvas = runtime.plugin.canvas3dContext?.canvas;
  if (!canvas) return () => undefined;
  let moveFrame = 0;
  let pendingPoint: MesoscaleCanvasPoint | null = null;
  let suppressClick = false;
  let suppressClickTimer = 0;
  let suppressPrimaryMouse = false;
  let suppressPrimaryMouseTimer = 0;
  let suppressContextMenu = false;
  let suppressContextMenuTimer = 0;
  let contextPointer: { pointerId: number; startX: number; startY: number; moved: boolean; ref: string } | null = null;
  let contextMouse: { startX: number; startY: number; moved: boolean; ref: string } | null = null;
  let mouseGesture = false;
  let activePointerId: number | null = null;
  const hasHostMenu = Boolean(window.BuretteConfig?.documentId && window.parent && window.parent !== window);
  const point = (event: PointerEvent | MouseEvent): MesoscaleCanvasPoint => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const emitSelection = () => postCanvasInteraction(runtime, { kind: "selection", summary: runtime.sceneSummary() });
  const controller = createMesoscaleCanvasInteractionController({
    pick: (target) => runtime.pickEntityRef(target),
    select: (ref, mode) => {
      try {
        runtime.selectEntityInteractive(ref, mode);
        emitSelection();
      } catch { /* stale pick after a scene update */ }
    },
    isSelected: (ref) => runtime.selectedRefs.has(ref),
    openContextMenu: (ref, target) => {
      const item = runtime.canvasItem(ref);
      if (!item) return;
      const rect = canvas.getBoundingClientRect();
      postCanvasInteraction(runtime, {
        kind: "context-menu",
        menu: { item, selectedCount: runtime.selectedRefs.size, x: target.x + rect.left, y: target.y + rect.top },
        summary: runtime.sceneSummary(),
      });
    },
  });
  const stop = (event: Event, preventDefault = true) => {
    if (preventDefault) event.preventDefault();
    event.stopImmediatePropagation();
  };
  const armContextMenuSuppression = () => {
    suppressContextMenu = true;
    window.clearTimeout(suppressContextMenuTimer);
    suppressContextMenuTimer = window.setTimeout(() => { suppressContextMenu = false; }, 1_000);
  };
  const clearContextMenuSuppression = () => {
    suppressContextMenu = false;
    window.clearTimeout(suppressContextMenuTimer);
  };
  const flushMove = () => {
    moveFrame = 0;
    if (!pendingPoint) return;
    const target = pendingPoint;
    pendingPoint = null;
    controller.pointerMove(target);
  };
  const finish = (event?: PointerEvent | MouseEvent, includePending = true) => {
    const wasActive = controller.active;
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    if (wasActive && includePending && pendingPoint) {
      controller.pointerMove(pendingPoint);
    }
    pendingPoint = null;
    if (wasActive) controller.pointerUp();
    canvas.classList.remove("burette-mesoscale-sweep-selecting");
    if (event instanceof PointerEvent) {
      try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* capture already ended */ }
    }
    activePointerId = null;
    window.clearTimeout(suppressClickTimer);
    suppressClick = event?.type === "pointerup" || event?.type === "mouseup";
    if (suppressClick) suppressClickTimer = window.setTimeout(() => { suppressClick = false; }, 0);
    window.clearTimeout(suppressPrimaryMouseTimer);
    suppressPrimaryMouseTimer = window.setTimeout(() => { suppressPrimaryMouse = false; }, 0);
    return wasActive;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.target !== canvas) return;
    if (event.button === 2) clearContextMenuSuppression();
    const target = point(event);
    const contextRef = event.button === 2 && hasHostMenu ? runtime.pickEntityRef(target) : null;
    if (contextRef) {
      contextPointer = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, ref: contextRef };
      return;
    }
    if (event.button !== 0 || !runtime.plugin.selectionMode) return;
    const extend = event.shiftKey || event.ctrlKey || event.metaKey;
    const started = controller.pointerDown(event.button, target, extend);
    if (shouldClearMesoscaleSelectionOnMiss(started, extend)) {
      runtime.clearSelection();
      emitSelection();
    }
    stop(event);
    suppressPrimaryMouse = true;
    activePointerId = event.pointerId;
    if (controller.active) canvas.classList.add("burette-mesoscale-sweep-selecting");
    try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (contextPointer && event.pointerId === contextPointer.pointerId && !contextPointer.moved) {
      contextPointer.moved = Math.hypot(event.clientX - contextPointer.startX, event.clientY - contextPointer.startY) > 6;
    }
    if (contextPointer && event.pointerId === contextPointer.pointerId) {
      // Let Mol* receive the original secondary-button stream so right-drag
      // remains native camera navigation. We only arbitrate click vs drag.
      return;
    }
    if (event.pointerId !== activePointerId) return;
    stop(event);
    if (!controller.active) return;
    pendingPoint = point(event);
    if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (contextPointer && event.pointerId === contextPointer.pointerId) {
      const gesture = contextPointer;
      contextPointer = null;
      armContextMenuSuppression();
      if (!gesture.moved) {
        controller.contextMenuFor(gesture.ref, point(event));
      }
      return;
    }
    if (event.pointerId !== activePointerId) return;
    stop(event);
    if (controller.active) pendingPoint = point(event);
    finish(event);
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (contextPointer?.pointerId === event.pointerId) {
      contextPointer = null;
    }
    if (event.pointerId !== activePointerId) return;
    stop(event);
    suppressPrimaryMouse = false;
    pendingPoint = null;
    finish(event);
  };
  const onLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return;
    pendingPoint = null;
    suppressPrimaryMouse = false;
    finish(undefined, false);
  };
  const onContextMenu = (event: MouseEvent) => {
    if (suppressContextMenu && event.target === canvas) {
      clearContextMenuSuppression();
      stop(event);
      return;
    }
    if (contextPointer && event.target === canvas) {
      stop(event);
      return;
    }
    if (contextMouse && event.target === canvas) {
      stop(event);
      return;
    }
    if (!hasHostMenu || event.target !== canvas || !controller.contextMenu(point(event))) return;
    stop(event);
  };
  const onClick = (event: MouseEvent) => {
    if (event.target !== canvas || !suppressClick) return;
    suppressClick = false;
    suppressPrimaryMouse = false;
    window.clearTimeout(suppressClickTimer);
    window.clearTimeout(suppressPrimaryMouseTimer);
    stop(event);
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.target !== canvas) return;
    if (event.button === 2 && hasHostMenu) {
      clearContextMenuSuppression();
      if (contextPointer) return;
      const target = point(event);
      const ref = runtime.pickEntityRef(target);
      if (ref) contextMouse = { startX: event.clientX, startY: event.clientY, moved: false, ref };
      return;
    }
    if (event.button !== 0) return;
    if (suppressPrimaryMouse) {
      stop(event);
      return;
    }
    if (!runtime.plugin.selectionMode) return;
    const extend = event.shiftKey || event.ctrlKey || event.metaKey;
    const started = controller.pointerDown(event.button, point(event), extend);
    if (shouldClearMesoscaleSelectionOnMiss(started, extend)) {
      runtime.clearSelection();
      emitSelection();
    }
    mouseGesture = true;
    if (controller.active) canvas.classList.add("burette-mesoscale-sweep-selecting");
    stop(event);
  };
  const onMouseMove = (event: MouseEvent) => {
    if (contextMouse && (event.buttons & 2) !== 0 && !contextMouse.moved) {
      contextMouse.moved = Math.hypot(event.clientX - contextMouse.startX, event.clientY - contextMouse.startY) > 6;
    }
    if (mouseGesture) {
      stop(event);
      if (!controller.active) return;
      pendingPoint = point(event);
      if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
      return;
    }
    if (!suppressPrimaryMouse || (event.buttons & 1) === 0) return;
    stop(event);
  };
  const onMouseUp = (event: MouseEvent) => {
    if (event.button === 2 && contextMouse) {
      const gesture = contextMouse;
      contextMouse = null;
      armContextMenuSuppression();
      if (!gesture.moved) controller.contextMenuFor(gesture.ref, point(event));
      return;
    }
    if (event.button !== 0) return;
    if (mouseGesture) {
      mouseGesture = false;
      stop(event);
      if (controller.active) pendingPoint = point(event);
      finish(event);
      return;
    }
    if (!suppressPrimaryMouse) return;
    stop(event);
    suppressPrimaryMouse = false;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (controller.active || mouseGesture || activePointerId !== null)) {
      mouseGesture = false;
      suppressPrimaryMouse = false;
      pendingPoint = null;
      finish(undefined, false);
    }
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseup", onMouseUp, true);
  canvas.addEventListener("lostpointercapture", onLostPointerCapture, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    if (moveFrame) cancelAnimationFrame(moveFrame);
    window.clearTimeout(suppressClickTimer);
    window.clearTimeout(suppressPrimaryMouseTimer);
    window.clearTimeout(suppressContextMenuTimer);
    mouseGesture = false;
    contextPointer = null;
    contextMouse = null;
    canvas.classList.remove("burette-mesoscale-sweep-selecting");
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    canvas.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}

function installActionBridge(runtime: MesoscaleRuntimeApi) {
  let v2Queue = Promise.resolve();
  window.addEventListener("message", (event) => {
    const envelope = event.data;
    if (envelope?.source === "burette-mesoscale-chrome") {
      const chrome = envelope as MesoscaleChromeMessage;
      const expectedDocumentId = window.BuretteConfig?.documentId;
      if (event.source === window.parent && chrome.apiVersion === MESOSCALE_API_VERSION && chrome.documentId === expectedDocumentId) {
        applyControlPlacement(chrome.placement);
      }
      return;
    }
    if (envelope?.source === "burette-mesoscale-preview") {
      const preview = envelope as MesoscalePreviewMessage;
      const expectedDocumentId = window.BuretteConfig?.documentId;
      if (event.source === window.parent && preview.apiVersion === MESOSCALE_API_VERSION && preview.documentId === expectedDocumentId) {
        runtime.highlightObject(preview.ref, preview.sequence, preview.selector);
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
      const execute = async (): Promise<MesoscaleResult> => {
        if (request.expectedRevision !== undefined && request.expectedRevision !== runtime.revision && request.action.type !== "getSummary" && request.action.type !== "getHierarchyPage") {
          return { kind: "failure", code: "REVISION_CONFLICT", message: "Mesoscale state changed before this action was applied", revision: runtime.revision };
        }
        try {
          return await runtime.runV2(request.action);
        } catch (error) {
          return { kind: "failure", code: "MESOSCALE_ACTION_FAILED", message: String((error as Error)?.message || error), revision: runtime.revision };
        }
      };
      const queued = v2Queue.then(execute, execute);
      v2Queue = queued.then(() => undefined, () => undefined);
      void queued.then(reply);
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
    viewportShowAnimation: false,
    viewportShowTrajectoryControls: false,
  });
  const runtime = new MesoscaleRuntimeApi(explorer);
  window.BuretteMesoscale = runtime;
  installActionBridge(runtime);
  await applyHostedInteractionBindings(runtime, hosted);
  applyViewerTheme(runtime, config.theme);
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => {
    if ((window.BuretteConfig?.theme ?? "auto") === "auto") applyViewerTheme(runtime, "auto");
  });
  await loadSource(runtime, config);
  // LoadModel reapplies the Mesoscale Explorer white/yellow selection preset.
  // Apply the Burette treatment after the scene exists so original entity
  // colors remain visible whenever a selection is active.
  applyBuretteSelectionAppearance(runtime);
  installBuretteSelectionAppearanceGuard(runtime);
  installBuretteSceneHover(runtime);
  installMesoscaleSelectionSync(runtime);
  installMesoscaleCanvasInteractions(runtime);
  const pluginRoot = document.querySelector<HTMLElement>(".msp-plugin");
  if (pluginRoot) installMesoscalePanelResizeHandles({
    root: pluginRoot,
    onResize: () => explorer.handleResize(),
    onReservations: (reservation) => postCanvasInteraction(runtime, { kind: "layout-resize", reservation }),
    onCollapse: (axis) => {
      // Squeezing a divider past its panel's minimum closes the panel, so the
      // toolbar's L/R toggles and the divider agree on one visibility state.
      const regions: MesoscaleLayoutRegion[] = axis === "bottom" ? ["left", "right"] : [axis];
      void Promise.all(regions.map((region) => runtime.setLayoutRegion(region, false)))
        .then(() => postCanvasInteraction(runtime, { kind: "layout-collapse", regions, summary: runtime.sceneSummary() }))
        .catch(() => undefined);
    },
  });
  explorer.handleResize();
  postSceneSummary(runtime, config.documentId);
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
