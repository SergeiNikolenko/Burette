import type { SidebarProjectStructure } from "./sidebar-projects";
import { writeBrowserDevVirtualTextDocument } from "./browser-dev-documents";

const WEB_DEMO_ROOT = "/BurreteDemo";
const WEB_DEMO_ENABLED = import.meta.env.VITE_BURRETE_WEB_DEMO === "1";
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const listeners = new Set<() => void>();
const files = new Map<string, SidebarProjectStructure>();

const miniPdb = `HEADER    BURRETE WEB DEMO
TITLE     MINI GLY-ALA PEPTIDE
ATOM      1  N   GLY A   1      -1.204   0.176   0.000  1.00 20.00           N
ATOM      2  CA  GLY A   1       0.000   0.000   0.000  1.00 20.00           C
ATOM      3  C   GLY A   1       0.722   1.271   0.000  1.00 20.00           C
ATOM      4  O   GLY A   1       0.163   2.360   0.000  1.00 20.00           O
ATOM      5  N   ALA A   2       2.052   1.189   0.000  1.00 20.00           N
ATOM      6  CA  ALA A   2       2.896   2.377   0.000  1.00 20.00           C
ATOM      7  CB  ALA A   2       3.711   2.273   1.276  1.00 20.00           C
ATOM      8  C   ALA A   2       3.793   2.477  -1.230  1.00 20.00           C
ATOM      9  O   ALA A   2       4.675   3.336  -1.236  1.00 20.00           O
TER
END
`;

const methaneXyz = `5
Methane
C 0 0 0
H 0.629 0.629 0.629
H -0.629 -0.629 0.629
H -0.629 0.629 -0.629
H 0.629 -0.629 -0.629
`;

export function isWebDemoWorkspace() {
  return WEB_DEMO_ENABLED;
}

export function initializeWebDemoWorkspace() {
  if (!WEB_DEMO_ENABLED || files.size > 0) return [];
  registerText(`${WEB_DEMO_ROOT}/structures/mini-protein.pdb`, miniPdb);
  registerText(`${WEB_DEMO_ROOT}/structures/ligands/methane.xyz`, methaneXyz);
  registerText(`${WEB_DEMO_ROOT}/notes/README.md`, "# Burrete browser workspace\n\nOpen a structure or choose a local project folder.\n");
  return [`${WEB_DEMO_ROOT}/structures/mini-protein.pdb`];
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
