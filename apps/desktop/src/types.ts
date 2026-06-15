import type { StructureDragPayload } from "./lib/structure-drag";

export type XyzrenderControls = {
  transparentBackground?: boolean | null;
  canvasSize?: number | null;
  atomScale?: number | null;
  bondWidth?: number | null;
  atomStrokeWidth?: number | null;
  molColor?: string | null;
  gradients?: boolean | null;
  fog?: boolean | null;
  fogStrength?: number | null;
  showVdw?: boolean | null;
  vdwOpacity?: number | null;
  vdwScale?: number | null;
  hideBonds?: boolean | null;
  showCell?: boolean | null;
  showGhosts?: boolean | null;
  showAxes?: boolean | null;
  cellWidth?: number | null;
  supercell?: [number, number, number] | null;
  fieldMode?: "auto" | "off" | "density" | "mo" | "esp" | "nci" | null;
  fieldIso?: number | null;
  fieldOpacity?: number | null;
  fieldSurfaceStyle?: "solid" | "mesh" | "contour" | "dot" | null;
  fieldMoPositiveColor?: string | null;
  fieldMoNegativeColor?: string | null;
  fieldDensityColor?: string | null;
  fieldCmapPalette?: string | null;
  fieldCmapMin?: number | null;
  fieldCmapMax?: number | null;
  customConfigPath?: string | null;
  extraArguments?: string | null;
};

export type OpenDocumentsResult = {
  documents: ViewerDocument[];
  errors: string[];
};

export type OpenDocumentsMode = "individual" | "combinePoses" | "combineGrid";

export type OpenTextFilesResult = {
  documents: TextFileDocument[];
  errors: string[];
};

export type ViewerReloadOptions = {
  xyzrenderOrientationRef?: string | null;
  xyzrenderPreset?: string | null;
  xyzrenderControls?: XyzrenderControls | null;
  sdfPoseControlLabel?: string | null;
};

export type DockingSceneMode = "structureAll" | "structurePoses";
export type DockingPoseMode = "all" | "single";

export type DockingDocumentRequest = {
  receptorPath: string;
  ligandPaths: string[];
  activePose?: number | null;
  sceneMode?: DockingSceneMode | null;
  poseMode?: DockingPoseMode | null;
};

export type FepSetupRequest = {
  receptorPath: string;
  gridDocumentId: string;
  gridPath: string;
  dockingDocumentId: string;
  dockingPath: string;
  referencePose: number;
  candidatePayload?: StructureDragPayload;
};

export type MergedCollectionDocument = {
  sourcePaths: string[];
  format: string;
  text?: string;
  suggestedFileName: string;
};

export type ViewerDocument = {
  id: string;
  path: string;
  title: string;
  extension: string;
  renderer: string;
  runtimePath: string;
  byteCount: number;
  virtual?: boolean;
  dockingRequest?: DockingDocumentRequest;
  mergedCollection?: MergedCollectionDocument;
};

export type TextFileDocument = {
  id: string;
  path: string;
  title: string;
  extension: string;
  language: string;
  byteCount: number;
  content: string;
  truncated: boolean;
  modifiedAt?: number | null;
};

export type RecentStructure = {
  path: string;
  title: string;
  extension: string;
  renderer: string;
  byteCount: number;
  openedAt: number;
};

export type ViewerPreferences = {
  theme: "auto" | "dark" | "light";
  canvasBackground: "auto" | "black" | "graphite" | "white" | "transparent";
  openInDefaultDestination: "default-app" | "finder" | `editor:${string}`;
  rendererMode: "auto" | "grid2d" | "molstar" | "xyzrender-external";
  molstarStyle: "default" | "illustrative";
  conformerEngine: "datamol" | "rdkit";
  conformerCandidateCount: number;
  conformerRmsdCutoff: number;
  themeLightAccent: string;
  themeLightBackground: string;
  themeLightForeground: string;
  themeLightUiFont: string;
  themeLightEditorFont: string;
  themeLightTranslucent: number;
  themeLightContrast: number;
  themeDarkAccent: string;
  themeDarkBackground: string;
  themeDarkForeground: string;
  themeDarkUiFont: string;
  themeDarkEditorFont: string;
  themeDarkTranslucent: number;
  themeDarkContrast: number;
};
