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
  trajectoryAutoPlayOnce?: boolean | null;
  molstarStyle?: "default" | "illustrative" | "polymer-ligand" | "cartoon" | "ball-and-stick" | "spacefill" | "line" | "molecular-surface" | null;
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

export type ConformerOperation = "crest-generate" | "prism-prune";

export type ConformerToolStatus = {
  installed: boolean;
  executable: string | null;
  version: string | null;
  installHint: string;
};

export type ConformerStatus = {
  crest: ConformerToolStatus;
  prism: ConformerToolStatus;
};

export type ConformerSettings = {
  method: "gfn2" | "gfn1" | "gfn0" | "gfnff";
  solvent: "none" | "water" | "methanol" | "acetonitrile" | "dmso" | "chloroform";
  charge: number;
  uhf: number;
  threads: number;
  timeoutSeconds: number;
  energyWindowKcalMol: number;
  rmsdThresholdAngstrom: number;
  samplingMode: "auto" | "normal" | "quick" | "squick" | "mquick";
  prismTimeoutSeconds: number;
  prismEnergySort: boolean;
  prismRotamerPruning: boolean;
};

export type ConformerRunRequest = {
  operation: ConformerOperation;
  jobId?: string | null;
  path: string;
  title: string;
  extension: string;
  inputDataBase64?: string | null;
  outputDirectory?: string | null;
  workDir?: string | null;
  method?: ConformerSettings["method"];
  solvent?: string | null;
  charge?: number;
  uhf?: number;
  threads?: number;
  timeoutSeconds?: number;
  energyWindowKcalMol?: number;
  rmsdThresholdAngstrom?: number;
  samplingMode?: ConformerSettings["samplingMode"];
  prismEnergySort?: boolean;
  prismRotamerPruning?: boolean;
};

export type ConformerPreparedRun = {
  operation: ConformerOperation;
  workDir: string;
  logPath: string;
  reportPath: string;
  outputRoot: string;
};

export type ConformerArtifact = {
  title: string;
  path: string;
  extension: string;
  byteCount: number;
  kind: "ensemble" | "report" | "log" | "summary" | "artifact";
  validEnsemble?: boolean;
};

export type ConformerRunResult = {
  ok: boolean;
  operation: ConformerOperation;
  title: string;
  inputPath: string;
  workDir: string;
  logPath: string;
  reportPath: string;
  exitCode: number;
  errorSummary?: string | null;
  elapsedMs: number;
  command: string[];
  preparation?: {
    path: string;
    source: string;
  };
  recovery?: string | null;
  artifacts: ConformerArtifact[];
  primaryOpenPath: string | null;
};

export type ConformerJob = {
  id: string;
  title: string;
  operation: ConformerOperation;
  inputTitle: string;
  status: "running" | "success" | "recovered" | "failed" | "cancelled";
  startedAt: number;
  workDir?: string | null;
  logPath?: string | null;
  completedAt?: number;
  result?: ConformerRunResult | null;
  error?: string | null;
};

export type XtbOperation =
  | "optimize"
  | "properties"
  | "grid-properties"
  | "fep-preflight"
  | "pose-refine"
  | "cube"
  | "hessian"
  | "optimized-hessian"
  | "vip"
  | "vea"
  | "vipea"
  | "vfukui"
  | "vomega"
  | "md"
  | "metadyn"
  | "dock";

export type XtbStatus = {
  installed: boolean;
  executablePath?: string | null;
  version?: string | null;
  installer?: string | null;
  installHint: string;
};

export type XtbSettings = {
  method: "gfn2" | "gfn1" | "gfn0" | "gfnff";
  optLevel: "loose" | "normal" | "tight" | "verytight";
  solvationModel: "none" | "alpb" | "gbsa" | "cosmo" | "cpcmx";
  solvent: string;
  charge: number;
  uhf: number;
  threads: number;
  accuracy: number;
  electronicTemperature: number;
  properties: {
    dipole: boolean;
    wbo: boolean;
    population: boolean;
    molden: boolean;
    alpha: boolean;
    fod: boolean;
    esp: boolean;
    fukui: boolean;
  };
  mdTemperature: number;
  mdTimePs: number;
  mdStepFs: number;
  mdSnapshots: number;
  timeoutSeconds: number;
  saveRunFiles: boolean;
};

export type XtbRunRequest = {
  operation: XtbOperation;
  jobId?: string | null;
  inputPath?: string | null;
  inputText?: string | null;
  inputExtension?: string | null;
  sourcePath?: string | null;
  secondaryPaths?: string[] | null;
  label?: string | null;
  method?: "gfn0" | "gfn1" | "gfn2" | "gfnff" | null;
  charge?: number | null;
  uhf?: number | null;
  optLevel?: "loose" | "normal" | "tight" | "verytight" | null;
  solvationModel?: "none" | "alpb" | "gbsa" | "cosmo" | "cpcmx" | null;
  solvent?: string | null;
  threads?: number | null;
  accuracy?: number | null;
  electronicTemperature?: number | null;
  properties?: XtbSettings["properties"] | null;
  mdTemperature?: number | null;
  mdTimePs?: number | null;
  mdStepFs?: number | null;
  mdSnapshots?: number | null;
  timeoutSeconds?: number | null;
  saveRunFiles?: boolean | null;
};

export type XtbArtifact = {
  path: string;
  title: string;
  extension: string;
  kind: string;
  byteCount: number;
};

export type XtbRunResult = {
  ok: boolean;
  operation: XtbOperation;
  command: string[];
  workDir: string;
  elapsedMs: number;
  exitCode?: number | null;
  logPath: string;
  reportPath: string;
  primaryOpenPath?: string | null;
  artifacts: XtbArtifact[];
  summary?: unknown;
  error?: string | null;
};

export type XtbJob = {
  id: string;
  title: string;
  operation: XtbOperation;
  status: "queued" | "running" | "success" | "recovered" | "failed" | "cancelled";
  inputLabel: string;
  startedAt: number;
  completedAt?: number | null;
  result?: XtbRunResult | null;
  error?: string | null;
};

export type FoldingArtifact = {
  path: string;
  title: string;
  extension: string;
  kind: string;
  byteCount: number;
};

export type FoldingMetric = {
  key: string;
  label: string;
  value: number;
  formatted: string;
};

export type FoldingProfile = {
  label: string;
  path: string;
  values: number[];
  min: number;
  max: number;
  mean: number;
};

export type FoldingMatrixPreview = {
  kind: string;
  label: string;
  path: string;
  shape: number[];
  values: Array<Array<number | null>>;
  xLabels?: string[];
  yLabels?: string[];
  min?: number | null;
  max?: number | null;
  mean?: number | null;
};

export type FoldingModel = {
  id: string;
  title: string;
  backend: string;
  seed?: number | null;
  modelIndex?: number | null;
  structurePath: string;
  structureTitle: string;
  metrics: FoldingMetric[];
  plddtProfile?: FoldingProfile | null;
  matrixPreview?: FoldingMatrixPreview | null;
  artifacts: FoldingArtifact[];
};

export type FoldingResultBundle = {
  rootPath: string;
  title: string;
  source: string;
  models: FoldingModel[];
  artifacts: FoldingArtifact[];
  warnings: string[];
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
  sourcePath?: string | null;
  dockingRequest?: DockingDocumentRequest;
  mergedCollection?: MergedCollectionDocument;
  xyzrenderControls?: XyzrenderControls | null;
  xyzrenderPreset?: string | null;
  xyzrenderPresetOptions?: Array<{ value: string; label: string }> | null;
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
  molstarStyle: "default" | "illustrative" | "polymer-ligand" | "cartoon" | "ball-and-stick" | "spacefill" | "line" | "molecular-surface";
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
