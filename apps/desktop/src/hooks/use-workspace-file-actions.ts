import { validatePoseFiles, validatePoseRecords } from "./workspace-chemical-copy";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../lib/tauri";
import type { StructureDragRecord } from "../lib/structure-drag";
import { toast } from "../components/ui/toast";
import { useRef } from "react";
import { readStructureTextDocument } from "../lib/structure-text";
import { activeViewerIframeForDocument, requestGridView, requestViewerAction } from "../lib/viewer-bridge";
import { writeClipboardText } from "../lib/clipboard";
import { fileCapabilities } from "../components/workspace-menu-items";
import type { ShellActions, ShellViewState } from "../components/types";
import type { ViewerDocument } from "../types";

export function useWorkspaceFileActions(state: ShellViewState, actions: ShellActions) {
  const added = useRef(new Map<string, string[]>());
  const scenePaths = (document: ViewerDocument) => Array.from(new Set([
    ...(document.dockingRequest ? [document.dockingRequest.receptorPath, ...document.dockingRequest.ligandPaths] : [document.path]),
    ...(added.current.get(document.id) ?? []),
  ]));
  const sceneTargets = (paths: string[]) => !paths.length ? [] : state.documents.filter(document =>
    document.renderer === "molstar"
    && state.tabs.some(tab => tab.location.kind === "file" && tab.location.documentId === document.id)
    && paths.every(path => fileCapabilities(path).scene && !scenePaths(document).includes(path))
    && scenePaths(document).length + paths.length <= 200).slice(0, 60);
  const focusViewer = async (document: ViewerDocument) => {
    actions.selectDocument(document.id);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (activeViewerIframeForDocument(document.id, document.renderer)?.contentWindow) {
        if (document.renderer !== "molstar") return;
        try {
          const state = await requestViewerAction(document.id, { type: "workspace_scene_state" }, 1200);
          if (state.ready) return;
        } catch { /* The iframe can mount before its message listener. */ }
      }
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    throw new Error("Open the document and wait for its viewer to load.");
  };
  const addToScene = async (paths: string[], document: ViewerDocument) => {
    if (!sceneTargets(paths).some(target => target.id === document.id)) throw new Error("These files cannot be added to this scene.");
    const sources = [];
    let total = 0;
    for (const path of paths) {
      const source = await readStructureTextDocument(path, undefined, { maxBytes: 24 * 1024 * 1024 - total });
      total += new TextEncoder().encode(source.content).byteLength;
      if (source.truncated || total > 24 * 1024 * 1024) throw new Error("Scene imports are limited to 24 MB at a time.");
      sources.push({ path, label: path.split('/').pop(), format: fileCapabilities(path).extension, data: source.content });
    }
    await focusViewer(document);
    await requestViewerAction(document.id, { type: "append_scene_files", sources, existingPaths: scenePaths(document) });
    added.current.set(document.id, [...(added.current.get(document.id) ?? []), ...paths]);
    toast.add({ title: "Added to scene", description: "Use Export → Scene to save the combined scene.", type: "info" });
  };
  const addRecordsToScene = async (records: StructureDragRecord[], document: ViewerDocument) => {
    await focusViewer(document);
    const paths = records.map(record => record.path);
    await requestViewerAction(document.id, { type: "append_scene_files", existingPaths: scenePaths(document), sources: records.map(record => ({
      path: record.path, label: record.path.split('/').pop(), format: record.inputExtension, data: record.text,
    })) });
    added.current.set(document.id, [...(added.current.get(document.id) ?? []), ...paths]);
    toast.add({ title: "Added to scene", description: "Use Export → Scene to save the combined scene.", type: "info" });
  };
  const gridView = async (path: string, mode: "table" | "cards") => {
    await actions.openStructurePaths([path], { rendererMode: "grid2d" });
    const { useMoleculeStore } = await import("../stores/molecule-store");
    const document = useMoleculeStore.getState().documents.find(document => document.path === path && document.renderer === "grid2d");
    if (!document) throw new Error("This file does not contain a molecular table.");
    await focusViewer(document);
    await requestGridView(document.id, mode);
  };
  const saveScene = async (document: ViewerDocument) => {
    await focusViewer(document);
    const result = await requestViewerAction(document.id, { type: "export_session", args: { type: "molj", maxBytes: 24 * 1024 * 1024 } });
    if (typeof result.dataBase64 !== "string") throw new Error("The scene did not return a session file.");
    const bytes = Uint8Array.from(atob(result.dataBase64), c => c.charCodeAt(0));
    await actions.saveKetcherExportFile({ title: document.title.replace(/\.[^.]+$/, '') + '.molj', extension: "molj", text: new TextDecoder().decode(bytes) });
  };
  const openRecordScene = async (records: StructureDragRecord[], mode: "all" | "single") => {
    if (records.length < 2 || records.length > 200 || !records.every(record => ['sdf', 'mol'].includes(record.inputExtension))) throw new Error("Choose 2–200 MOL or SDF records.");
    if (mode === "single") await validatePoseRecords(records);
    const text = records.map(record => record.text.replace(/\n?\$\$\$\$\s*$/, '').trimEnd() + '\n$$$$\n').join('');
    if (new TextEncoder().encode(text).byteLength > 24 * 1024 * 1024) throw new Error("Scene imports are limited to 24 MB.");
    const preferences = { ...state.preferences, rendererMode: "molstar" as const };
    const title = `Selected ${records.length} molecules.sdf`;
    const reloadOptions = { sdfPoseControlLabel: mode === "all" ? "Molecule" : "Pose" };
    const document = isTauriRuntime()
      ? await invoke<ViewerDocument>("open_text_structure", { request: { title, extension: "sdf", text }, preferences, reloadOptions })
      : await (await import("../lib/browser-dev-documents")).openBrowserDevTextDocument(title, "sdf", text, preferences, reloadOptions);
    const { useMoleculeStore } = await import("../stores/molecule-store");
    useMoleculeStore.getState().addDocuments([document]);
    await focusViewer(document);
    await requestViewerAction(document.id, { type: "set_sdf_pose_mode", mode });
  };
  const openPoses = async (paths: string[]) => {
    await validatePoseFiles(paths);
    await actions.openDockingDocument(paths[0], paths.slice(1), { sceneMode: "structurePoses" });
  };
  const openAligned = async (paths: string[]) => {
    const document = await actions.openDockingDocument(paths[0], paths.slice(1), { sceneMode: "structureAll" });
    if (!document) throw new Error("Could not open the combined scene.");
    await focusViewer(document);
    await requestViewerAction(document.id, { type: "align_scene_files" });
  };
  const exportStructure = async (document: ViewerDocument, format: "pdb" | "mmcif") => {
    await focusViewer(document);
    const result = await requestViewerAction(document.id, { type: "export_scene_structure", format });
    if (typeof result.text !== "string") throw new Error("No structure was returned.");
    await actions.saveKetcherExportFile({ title: String(result.name || document.title), extension: format === "mmcif" ? "cif" : format, text: result.text });
  };
  const copySequence = async (document: ViewerDocument) => {
    await focusViewer(document);
    const result = await requestViewerAction(document.id, { type: "copy_scene_sequence" });
    if (typeof result.text !== "string") throw new Error("No sequence was returned.");
    await writeClipboardText(result.text);
  };
  const exportImage = async (document: ViewerDocument) => {
    await focusViewer(document);
    const result = await requestViewerAction(document.id, { type: "screenshot", args: { format: "png" } });
    if (typeof result.dataUri !== "string" || !result.dataUri.startsWith('data:image/png;base64,')) throw new Error("No PNG image was returned.");
    const name = document.title.replace(/\.[^.]+$/, '') + '.png';
    if (isTauriRuntime()) {
      const outputPath = await save({ title: "Export Image", defaultPath: name, filters: [{ name: "PNG", extensions: ["png"] }] });
      if (outputPath) await invoke("write_base64_file", { request: { outputPath, contentsBase64: result.dataUri.split(',')[1] } });
    } else {
      const link = window.document.createElement('a'); link.href = result.dataUri; link.download = name; link.click();
    }
  };
  const copyNames = (paths: string[]) => writeClipboardText(paths.map(path => path.split('/').pop() || path).join('\n'));
  return { isCombinedScene: (document: ViewerDocument) => scenePaths(document).length > 1, sceneTargets, addToScene, addRecordsToScene, gridView, saveScene, copyNames, focusViewer, openRecordScene, openPoses, openAligned, exportStructure, copySequence, exportImage };
}
