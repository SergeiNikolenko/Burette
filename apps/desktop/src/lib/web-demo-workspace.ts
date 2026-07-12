import type { SidebarProjectStructure } from "./sidebar-projects";
import { writeBrowserDevVirtualTextDocument } from "./browser-dev-documents";
import extxyzCell from "../../../../samples/extxyz-cell.xyz?raw";
import ketcher2dBenzene from "../../../../samples/ketcher-2d-benzene.sdf?raw";
import ketcher3dCore from "../../../../samples/ketcher-3d-core.sdf?raw";
import miniCif from "../../../../samples/mini.cif?raw";
import miniPdb from "../../../../samples/mini.pdb?raw";
import miniSdf from "../../../../samples/mini.sdf?raw";
import miniXyz from "../../../../samples/mini.xyz?raw";
import pairedPdb from "../../../../samples/md/paired/paired.pdb?raw";
import nad2d from "../../../../samples/nad-2d.sdf?raw";
import caffeineCif from "../../../../samples/structures/crystals/caffeine.cif?raw";
import mof5 from "../../../../samples/structures/crystals/mof-5.xyz?raw";
import nv63Cell from "../../../../samples/structures/crystals/nv63-cell.xyz?raw";
import oneHtb from "../../../../samples/structures/proteins/1htb.pdb?raw";
import benzene from "../../../../samples/structures/small-molecules/benzene.xyz?raw";
import caffeineSdf from "../../../../samples/structures/small-molecules/caffeine.sdf?raw";
import multiMolecule from "../../../../samples/structures/small-molecules/multi-molecule.sdf?raw";
import trajectory from "../../../../samples/trajectory.xyz?raw";

const WEB_DEMO_ROOT = "/BurreteDemo";
const WEB_DEMO_ENABLED = import.meta.env.VITE_BURRETE_WEB_DEMO === "1";
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const listeners = new Set<() => void>();
const files = new Map<string, SidebarProjectStructure>();

const DEMO_STRUCTURES = [
  ["proteins/1HTB.pdb", oneHtb],
  ["proteins/paired.pdb", pairedPdb],
  ["crystals/caffeine.cif", caffeineCif],
  ["crystals/MOF-5.xyz", mof5],
  ["crystals/NV63-cell.xyz", nv63Cell],
  ["small-molecules/benzene.xyz", benzene],
  ["small-molecules/caffeine.sdf", caffeineSdf],
  ["small-molecules/multi-molecule.sdf", multiMolecule],
  ["small-molecules/NAD.sdf", nad2d],
  ["trajectories/trajectory.xyz", trajectory],
  ["trajectories/extxyz-cell.xyz", extxyzCell],
  ["ketcher/benzene-2d.sdf", ketcher2dBenzene],
  ["ketcher/core-3d.sdf", ketcher3dCore],
  ["formats/mini.pdb", miniPdb],
  ["formats/mini.cif", miniCif],
  ["formats/mini.sdf", miniSdf],
  ["formats/mini.xyz", miniXyz],
] as const;

export function isWebDemoWorkspace() {
  return WEB_DEMO_ENABLED;
}

export function initializeWebDemoWorkspace() {
  if (!WEB_DEMO_ENABLED || files.size > 0) return [];
  for (const [relativePath, text] of DEMO_STRUCTURES) {
    registerText(`${WEB_DEMO_ROOT}/${relativePath}`, text);
  }
  registerText(`${WEB_DEMO_ROOT}/notes/README.md`, "# Burrete browser workspace\n\nOpen a structure or choose a local project folder.\n");
  return [`${WEB_DEMO_ROOT}/proteins/1HTB.pdb`];
}

export function webDemoProjectRoot() {
  return WEB_DEMO_ENABLED ? WEB_DEMO_ROOT : null;
}

export function webDemoProjectStructures() {
  return Array.from(files.values());
}

export function subscribeWebDemoWorkspace(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function pickWebDemoFiles(options: { directory?: boolean } = {}) {
  if (!WEB_DEMO_ENABLED) return null;
  const selected = await selectFiles(options.directory === true);
  if (selected.length === 0) return null;
  const rootName = options.directory
    ? cleanSegment(selected[0]?.webkitRelativePath.split("/")[0] || "LocalProject")
    : "OpenedFiles";
  const root = `/${rootName}`;
  const paths: string[] = [];
  for (const file of selected) {
    if (file.size > MAX_FILE_BYTES) continue;
    const relativePath = options.directory ? file.webkitRelativePath : file.name;
    const path = `${root}/${relativePath.split("/").slice(options.directory ? 1 : 0).map(cleanSegment).join("/")}`;
    if (!path || path.endsWith("/")) continue;
    registerText(path, await file.text(), file.size);
    paths.push(path);
  }
  emitChange();
  return paths.length > 0 ? { root, paths } : null;
}

function registerText(path: string, text: string, byteCount = new TextEncoder().encode(text).length) {
  writeBrowserDevVirtualTextDocument(path, text);
  const title = path.split("/").filter(Boolean).pop() || path;
  const extension = title.includes(".") ? title.split(".").pop()?.toLowerCase() || "" : "";
  files.set(path, {
    path,
    title,
    extension,
    renderer: "molstar",
    byteCount,
    openedAt: null,
  });
}

function selectFiles(directory: boolean) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) input.setAttribute("webkitdirectory", "");
    input.accept = ".pdb,.ent,.pdbqt,.pqr,.cif,.mmcif,.mcif,.sdf,.sd,.mol,.mol2,.xyz,.gro,.txt,.md,.log,.out,.json";
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
    input.click();
  });
}

function cleanSegment(value: string) {
  return value.trim().replaceAll("/", "_").replaceAll("\\", "_") || "untitled";
}

function emitChange() {
  for (const listener of listeners) listener();
}
