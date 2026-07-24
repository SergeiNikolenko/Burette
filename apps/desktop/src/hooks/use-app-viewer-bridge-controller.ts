import type { Dispatch, SetStateAction } from "react";
import { useAppDockingPoseMessages } from "./use-app-docking-pose-messages";
import { useAppGridConformerMessages } from "./use-app-grid-conformer-messages";
import { useAppGridComputeMessages } from "./use-app-grid-compute-messages";
import { useAppGridControlMessages } from "./use-app-grid-control-messages";
import { useAppGridFileActions } from "./use-app-grid-file-actions";
import { useAppGridRuntimeMessages } from "./use-app-grid-runtime-messages";
import { useAppKetcherViewerMessages } from "./use-app-ketcher-viewer-messages";
import { useAppMolstarContextMessages } from "./use-app-molstar-context-messages";
import { useAppPubChemMessages } from "./use-app-pubchem-messages";
import { useAppRendererMessage } from "./use-app-renderer-message";
import { useAppSdfViewerMessages } from "./use-app-sdf-viewer-messages";
import { useAppViewerBridgeMessages } from "./use-app-viewer-bridge-messages";
import { useAppViewerConformerMessages } from "./use-app-viewer-conformer-messages";
import { useAppViewerFileActions } from "./use-app-viewer-file-actions";
import { useAppViewerHostMessages } from "./use-app-viewer-host-messages";
import { useAppViewerRuntimeFileMessages } from "./use-app-viewer-runtime-file-messages";
import { useAppViewerRuntimeMessages } from "./use-app-viewer-runtime-messages";
import { useAppViewerStateMessages } from "./use-app-viewer-state-messages";
import { useAppXyzrenderSheetMessages } from "./use-app-xyzrender-sheet-messages";
import { openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { writeClipboardText } from "../lib/clipboard";
import { postMessageToViewerSource, isKnownViewerMessageSource } from "../lib/viewer-bridge";
import type { GridFilterModel } from "../components/types";
import type { StructureOverlayMode, ViewerLigandSelection } from "../components/types";
import type { ConformerGenerationMode, MolstarStylePreference } from "../lib/conformer-generation";
import type { MolecularComputeOperation } from "../lib/standalone-compute";
import type { DockTabKind } from "../lib/dock";
import type { GridNativeMenuState } from "../lib/native-menu";
import type { StructureStory } from "../lib/structure-story";
import type { PendingMolstarReplaceResolver } from "./use-app-generate-3d-conformer";
import type { DockingSceneMode, ViewerDocument, ViewerPreferences, ViewerReloadOptions } from "../types";

type RefValue<T> = { current: T };
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenDocuments = (
  paths: string[],
  reloadOptions?: ViewerReloadOptions,
  preferencesOverride?: Partial<ViewerPreferences>,
  options?: { replace?: boolean; inActiveTab?: boolean },
) => Promise<unknown> | void;
type OpenDocumentsInActiveTab = (
  documents: ViewerDocument[],
  options?: { backLocation?: { kind: "file"; documentId: string; path: string } },
) => void;
type OpenDockingDocument = (
  receptorPath: string,
  ligandPaths: string[],
  options?: { activePose?: number | null; sceneMode?: DockingSceneMode | null },
) => Promise<ViewerDocument | null> | void;
type OpenPoseReviewWorkspace = (
  receptorDocument: ViewerDocument,
  gridDocument: ViewerDocument,
  activePose: number,
) => Promise<void> | void;
type KetcherGridRowSource = {
  kind: "grid-row";
  documentId: string;
  rowIndex: number;
  title: string;
  extension: string;
};
type OpenKetcherWithFragment = (
  title: string,
  text: string,
  source?: KetcherGridRowSource,
  extensionOverride?: string,
) => void;
type OpenKetcherWithStructures = (
  paths: string[],
  fragments?: Array<{
    title: string;
    text: string;
    source3d?: {
      title: string;
      extension: string;
      text: string;
    };
    source?: KetcherGridRowSource;
  }>,
) => void;
type Generate3DConformer = (
  document: ViewerDocument,
  mode?: ConformerGenerationMode,
  molstarStyle?: MolstarStylePreference | null,
) => Promise<void>;
type RunMolecularCompute = (
  document: ViewerDocument,
  operation: MolecularComputeOperation,
  molstarStyle?: MolstarStylePreference | null,
) => Promise<void>;

type UseAppViewerBridgeControllerOptions = {
  activeDocument: ViewerDocument | null;
  addBackgroundDocuments: (documents: ViewerDocument[]) => void;
  addDocuments: (documents: ViewerDocument[]) => void;
  calculateGridDescriptors: (documentId: string, options?: { rowIndexes?: number[] }) => void;
  updateGridFilterModel: (documentId: string, model: GridFilterModel, source: MessageEventSource | null) => void;
  closeGridRuntime: (documentId: string | null | undefined) => void;
  documents: ViewerDocument[];
  forgetDirtyGridDocument: (documentId: string | null | undefined) => void;
  generate3DConformer: Generate3DConformer;
  runMolecularCompute: RunMolecularCompute;
  notifyGridPoseReviewSelection: (targetDocumentId: string, activePose: number) => void;
  openDockingDocument: OpenDockingDocument;
  openDocuments: OpenDocuments;
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  openDocumentsInActiveTab: OpenDocumentsInActiveTab;
  openKetcherWithFragment: OpenKetcherWithFragment;
  openKetcherWithStructures: OpenKetcherWithStructures;
  openCommandPalette: () => void;
  openDockTab: (area: "right", kind: DockTabKind) => void;
  openPoseReviewWorkspace: OpenPoseReviewWorkspace;
  pendingMolstarReplaceRef: RefValue<Map<string, PendingMolstarReplaceResolver>>;
  pendingViewerReloadDocumentIdRef: RefValue<string | null>;
  pendingViewerReloadOptionsRef: RefValue<ViewerReloadOptions | null>;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  rebindSavedGridDocument: (documentId: string, path: string) => Promise<ViewerDocument>;
  reloadActive: () => Promise<void>;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  setPoseReviewSelections: Dispatch<SetStateAction<Record<string, number>>>;
  setStructureOverlayModes: Dispatch<SetStateAction<Record<string, StructureOverlayMode>>>;
  setStructureStories: Dispatch<SetStateAction<Record<string, StructureStory | null>>>;
  setViewerLigandSelections: Dispatch<SetStateAction<Record<string, ViewerLigandSelection | null>>>;
  skipNextPreferenceRefreshRef: RefValue<boolean>;
  toggleSidebar: () => void;
  updateDirtyGridDocument: (documentId: string | null | undefined, dirty: boolean) => void;
  updateGridMenuState: (documentId: string, state: GridNativeMenuState) => void;
  writeGridPerfMetric: (metric: unknown) => void | Promise<void>;
  xyzrenderOrientationRefRef: RefValue<string | null>;
};

export function useAppViewerBridgeController({
  activeDocument,
  updateGridFilterModel,
  addBackgroundDocuments,
  addDocuments,
  calculateGridDescriptors,
  closeGridRuntime,
  documents,
  forgetDirtyGridDocument,
  generate3DConformer,
  runMolecularCompute,
  notifyGridPoseReviewSelection,
  openDockingDocument,
  openDocuments,
  openTextDocuments,
  openDocumentsInActiveTab,
  openKetcherWithFragment,
  openKetcherWithStructures,
  openCommandPalette,
  openDockTab,
  openPoseReviewWorkspace,
  pendingMolstarReplaceRef,
  pendingViewerReloadDocumentIdRef,
  pendingViewerReloadOptionsRef,
  preferences,
  pushErrorStatus,
  pushStatus,
  rebindSavedGridDocument,
  reloadActive,
  rememberRecentStructures,
  setPreference,
  setPoseReviewSelections,
  setStructureOverlayModes,
  setStructureStories,
  setViewerLigandSelections,
  skipNextPreferenceRefreshRef,
  toggleSidebar,
  updateDirtyGridDocument,
  updateGridMenuState,
  writeGridPerfMetric,
  xyzrenderOrientationRefRef,
}: UseAppViewerBridgeControllerOptions) {
  const { handleGridFileMessage } = useAppGridFileActions({
    closeGridRuntime,
    documents,
    forgetDirtyGridDocument,
    postMessageToViewerSource,
    pushErrorStatus,
    pushStatus,
    rebindSavedGridDocument,
  });
  const { handleGridRuntimeMessage } = useAppGridRuntimeMessages({
    postMessageToViewerSource,
  });
  const { handleGridControlMessage } = useAppGridControlMessages({
    activeDocument,
    updateGridFilterModel,
    calculateGridDescriptors,
    documents,
    openKetcherWithFragment,
    openKetcherWithStructures,
    pushErrorStatus,
    pushStatus,
    updateDirtyGridDocument,
    updateGridMenuState,
    writeClipboardText,
    writeGridPerfMetric,
  });
  const { handleGridConformerMessage } = useAppGridConformerMessages({
    openDocuments,
    openDocumentsInActiveTab,
    openTextDocuments,
    postMessageToViewerSource,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
  });
  const { handleGridComputeMessage } = useAppGridComputeMessages({
    openTextDocuments,
    postMessageToViewerSource,
    pushStatus,
  });
  const { handleKetcherViewerMessage } = useAppKetcherViewerMessages({
    activeDocument,
    documents,
    openKetcherWithFragment,
    openKetcherWithStructures,
    pushStatus,
  });
  const { handleViewerHostMessage } = useAppViewerHostMessages({
    pendingMolstarReplaceRef,
    pushStatus,
  });
  const { handleViewerConformerMessage } = useAppViewerConformerMessages({
    activeDocument,
    documents,
    generate3DConformer,
    runMolecularCompute,
    postMessageToViewerSource,
    pushStatus,
  });
  const { handleMolstarContextMessage } = useAppMolstarContextMessages({
    activeDocument,
    addDocuments,
    documents,
    openDockingDocument,
    openDocuments,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
  });
  const { handlePubChemSearchMessage } = useAppPubChemMessages({ pushStatus });
  const { handleViewerFileMessage } = useAppViewerFileActions({
    pushErrorStatus,
    pushStatus,
  });
  const { handleXyzrenderSheetMessage } = useAppXyzrenderSheetMessages({
    postMessageToViewerSource,
  });
  const { handleViewerRuntimeMessage, markViewerFirstRenderMessage } = useAppViewerRuntimeMessages({
    documents,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    pushStatus,
    reloadActive,
    xyzrenderOrientationRefRef,
  });
  const { handleRendererMessage } = useAppRendererMessage({
    activeDocument,
    documents,
    openDocuments,
    pendingViewerReloadDocumentIdRef,
    pendingViewerReloadOptionsRef,
    setPreference,
    skipNextPreferenceRefreshRef,
    xyzrenderOrientationRefRef,
  });
  const { handleViewerRuntimeFileMessage } = useAppViewerRuntimeFileMessages({
    activeDocument,
    documents,
    postMessageToViewerSource,
  });
  const { handleViewerStateMessage } = useAppViewerStateMessages({
    activeDocument,
    addDocuments,
    documents,
    openCommandPalette,
    openDockTab,
    setPreference,
    setViewerLigandSelections,
    setStructureOverlayModes,
    setStructureStories,
    toggleSidebar,
  });
  const { handleDockingPoseMessage } = useAppDockingPoseMessages({
    activeDocument,
    addBackgroundDocuments,
    documents,
    notifyGridPoseReviewSelection,
    setPoseReviewSelections,
  });
  const { handleSdfViewerMessage } = useAppSdfViewerMessages({
    activeDocument,
    documents,
    openBrowserDevTextDocument,
    openDockingDocument,
    openDocuments,
    openDocumentsInActiveTab,
    openPoseReviewWorkspace,
    preferences,
    pushErrorStatus,
    pushStatus,
    rememberRecentStructures,
    setPoseReviewSelections,
  });

  useAppViewerBridgeMessages({
    handleDockingPoseMessage,
    handleGridConformerMessage,
    handleGridComputeMessage,
    handleGridControlMessage,
    handleGridFileMessage,
    handleGridRuntimeMessage,
    handleKetcherViewerMessage,
    handleMolstarContextMessage,
    handlePubChemSearchMessage,
    handleRendererMessage,
    handleSdfViewerMessage,
    handleViewerConformerMessage,
    handleViewerFileMessage,
    handleViewerHostMessage,
    handleViewerRuntimeFileMessage,
    handleViewerRuntimeMessage,
    handleViewerStateMessage,
    handleXyzrenderSheetMessage,
    isKnownViewerMessageSource,
    markViewerFirstRenderMessage,
  });
}
