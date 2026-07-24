export const MENU_COMMAND_EVENT = "menu:command";
export const EXIT_PREFLIGHT_EVENT = "app:exit-preflight";
export const EXIT_TRANSITION_RESUMED_EVENT = "app:exit-transition-resumed";
const DOCUMENT_REGISTRY_REVISION_KEY = "burette.document-registry-revision";

let documentRegistryRevision = 0;

function storedDocumentRegistryRevision() {
  try {
    const revision = Number.parseInt(sessionStorage.getItem(DOCUMENT_REGISTRY_REVISION_KEY) ?? "0", 10);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  } catch {
    return 0;
  }
}

export function nextDocumentRegistryRevision() {
  documentRegistryRevision = Math.max(documentRegistryRevision, storedDocumentRegistryRevision()) + 1;
  try {
    sessionStorage.setItem(DOCUMENT_REGISTRY_REVISION_KEY, String(documentRegistryRevision));
  } catch {}
  return documentRegistryRevision;
}

export function currentDocumentRegistryRevision() {
  return Math.max(documentRegistryRevision, storedDocumentRegistryRevision());
}

export type ExitPreflightRequest = {
  requestId: string;
};

export type NativeMenuCommand = {
  command: string;
  recentPath?: string;
};

export type NativeMenuState = {
  documentRegistryRevision: number;
  hasActiveTab: boolean;
  activeTabClosable: boolean;
  tabCount: number;
  closableTabCount: number;
  hasActiveFile: boolean;
  hasActiveDocument: boolean;
  canExportExternalPreview: boolean;
  documentDirty: boolean;
  isGrid: boolean;
  sidebarOpen: boolean;
  rightDockOpen: boolean;
  bottomDockOpen: boolean;
  canSave: boolean;
  canSaveAs: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  gridEditingText: boolean;
  gridViewMode: GridNativeMenuState["viewMode"] | null;
  gridPropertiesShown: boolean;
  gridCardRenderer: GridNativeMenuState["cardRenderer"] | null;
  selectedMoleculeCount: number;
  selectedGridRowCount: number;
  gridHasMolecules: boolean;
  gridDirty: boolean;
  gridExportEnabled: boolean;
  gridSelectionEnabled: boolean;
  gridSupportsXyzrender: boolean;
  gridGenerating3d: boolean;
  canOpenInMolstar: boolean;
  canEditInKetcher: boolean;
  canGenerate3d: boolean;
  canRunCrest: boolean;
  canRunPrism: boolean;
  canRunXtb: boolean;
  openDocumentPaths: string[];
  recentDocuments: Array<{ path: string; title: string }> | null;
};

export type GridNativeMenuState = {
  selectedCount: number;
  selectedStructureCount: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  editingText: boolean;
  viewMode: "cards" | "table";
  showProperties: boolean;
  cardRenderer: "rdkit" | "xyzrender";
  hasMolecules: boolean;
  saveEnabled: boolean;
  exportEnabled: boolean;
  selectionEnabled: boolean;
  canOpenSelectedInMolstar: boolean;
  canOpenSelectedInKetcher: boolean;
  canGenerate3dForSelection: boolean;
  supportsXyzrender: boolean;
  generating3d: boolean;
};
