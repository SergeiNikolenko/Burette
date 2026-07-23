import type { ShellViewState, ViewerLigandSelection } from "../components/types";
import type { StructureStory } from "../lib/structure-story";

type AppShellViewStateInput = Omit<
  ShellViewState,
  "activeDocumentId" | "visibleDocuments" | "viewerLigandSelection" | "structureStory"
> & {
  viewerLigandSelections: Record<string, ViewerLigandSelection | null>;
  structureStories: Record<string, StructureStory | null>;
};

type DocumentShellViewState = Pick<
  ShellViewState,
  | "documents"
  | "textDocuments"
  | "tabs"
  | "activeTab"
  | "activeTabId"
  | "activeDocument"
  | "activeDocumentId"
  | "visibleDocuments"
>;

type WorkspaceShellViewState = Pick<
  ShellViewState,
  | "recentStructures"
  | "sidebarProjects"
  | "projectsOpen"
  | "expandedProjectIds"
  | "projectNameOverrides"
  | "pinnedStructurePaths"
  | "workspacePath"
  | "sidebarQuery"
>;

type LayoutShellViewState = Pick<
  ShellViewState,
  | "page"
  | "sidebarOpen"
  | "sidebarWidth"
  | "status"
  | "dropActive"
  | "buildInfo"
  | "quickLookDocument"
  | "quickLookError"
  | "quickLookStandalone"
>;

type DockShellViewState = Pick<
  ShellViewState,
  | "rightDockOpen"
  | "rightDockWidth"
  | "rightDockTabs"
  | "rightDockActiveTab"
  | "rightDockDocumentId"
  | "rightDockTool"
  | "bottomDockOpen"
  | "bottomDockHeight"
  | "bottomDockTabs"
  | "bottomDockActiveTab"
  | "bottomDockDocumentId"
  | "bottomDockTool"
  | "dockDroppedStructures"
  | "structureDragActive"
>;

type KetcherShellViewState = Pick<
  ShellViewState,
  "ketcherImportRequest" | "ketcherDraftMolfile"
>;

type GridShellViewState = Pick<ShellViewState, "descriptorSource">;

type DockingShellViewState = Pick<ShellViewState, "poseReviewSelections">;

type ViewerShellViewState = Pick<
  ShellViewState,
  "viewerLigandSelection" | "structureStory" | "structureOverlayMode"
>;

type ChemistryShellViewState = Pick<
  ShellViewState,
  | "conformerStatus"
  | "conformerSettings"
  | "conformerJobs"
  | "xtbStatus"
  | "xtbSettings"
  | "xtbJobs"
>;

type SettingsShellViewState = Pick<ShellViewState, "preferences" | "update">;

export type AppShellViewStateSlices = {
  documents: DocumentShellViewState;
  workspace: WorkspaceShellViewState;
  layout: LayoutShellViewState;
  dock: DockShellViewState;
  ketcher: KetcherShellViewState;
  grid: GridShellViewState;
  docking: DockingShellViewState;
  viewer: ViewerShellViewState;
  chemistry: ChemistryShellViewState;
  settings: SettingsShellViewState;
};

export function createAppShellViewState(input: AppShellViewStateInput): ShellViewState {
  return flattenAppShellViewStateSlices(createAppShellViewStateSlices(input));
}

export function flattenAppShellViewStateSlices(slices: AppShellViewStateSlices): ShellViewState {
  return {
    ...slices.documents,
    ...slices.workspace,
    ...slices.layout,
    ...slices.dock,
    ...slices.ketcher,
    ...slices.grid,
    ...slices.docking,
    ...slices.viewer,
    ...slices.chemistry,
    ...slices.settings,
  };
}

export function createAppShellViewStateSlices(input: AppShellViewStateInput): AppShellViewStateSlices {
  const { viewerLigandSelections, structureStories, ...state } = input;
  return {
    documents: {
      documents: state.documents,
      textDocuments: state.textDocuments,
      tabs: state.tabs,
      activeTab: state.activeTab,
      activeTabId: state.activeTabId,
      activeDocument: state.activeDocument,
      activeDocumentId: state.activeDocument?.id ?? null,
      visibleDocuments: state.documents,
    },
    workspace: {
      recentStructures: state.recentStructures,
      sidebarProjects: state.sidebarProjects,
      projectsOpen: state.projectsOpen,
      expandedProjectIds: state.expandedProjectIds,
      projectNameOverrides: state.projectNameOverrides,
      pinnedStructurePaths: state.pinnedStructurePaths,
      workspacePath: state.workspacePath,
      sidebarQuery: state.sidebarQuery,
    },
    layout: {
      page: state.page,
      sidebarOpen: state.sidebarOpen,
      sidebarWidth: state.sidebarWidth,
      status: state.status,
      dropActive: state.dropActive,
      buildInfo: state.buildInfo,
      quickLookDocument: state.quickLookDocument,
      quickLookError: state.quickLookError,
      quickLookStandalone: state.quickLookStandalone,
    },
    dock: {
      rightDockOpen: state.rightDockOpen,
      rightDockWidth: state.rightDockWidth,
      rightDockTabs: state.rightDockTabs,
      rightDockActiveTab: state.rightDockActiveTab,
      rightDockDocumentId: state.rightDockDocumentId,
      rightDockTool: state.rightDockTool,
      bottomDockOpen: state.bottomDockOpen,
      bottomDockHeight: state.bottomDockHeight,
      bottomDockTabs: state.bottomDockTabs,
      bottomDockActiveTab: state.bottomDockActiveTab,
      bottomDockDocumentId: state.bottomDockDocumentId,
      bottomDockTool: state.bottomDockTool,
      dockDroppedStructures: state.dockDroppedStructures,
      structureDragActive: state.structureDragActive,
    },
    ketcher: {
      ketcherImportRequest: state.ketcherImportRequest,
      ketcherDraftMolfile: state.ketcherDraftMolfile,
    },
    grid: {
      descriptorSource: state.descriptorSource,
    },
    docking: {
      poseReviewSelections: state.poseReviewSelections,
    },
    viewer: {
      viewerLigandSelection: state.activeDocument
        ? viewerLigandSelections[state.activeDocument.id] ?? null
        : null,
      structureStory: state.activeDocument
        ? structureStories[state.activeDocument.id] ?? null
        : null,
      structureOverlayMode: state.structureOverlayMode,
    },
    chemistry: {
      conformerStatus: state.conformerStatus,
      conformerSettings: state.conformerSettings,
      conformerJobs: state.conformerJobs,
      xtbStatus: state.xtbStatus,
      xtbSettings: state.xtbSettings,
      xtbJobs: state.xtbJobs,
    },
    settings: {
      preferences: state.preferences,
      update: state.update,
    },
  };
}

export function useAppShellViewState(input: AppShellViewStateInput): ShellViewState {
  return createAppShellViewState(input);
}
