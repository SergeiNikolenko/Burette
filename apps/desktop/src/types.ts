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
  customConfigPath?: string | null;
  extraArguments?: string | null;
};

export type OpenDocumentsResult = {
  documents: ViewerDocument[];
  errors: string[];
};

export type ViewerReloadOptions = {
  xyzrenderOrientationRef?: string | null;
  xyzrenderPreset?: string | null;
  xyzrenderControls?: XyzrenderControls | null;
};

export type ViewerDocument = {
  id: string;
  path: string;
  title: string;
  extension: string;
  renderer: string;
  runtimePath: string;
  byteCount: number;
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
  rendererMode: "auto" | "xyz-fast" | "molstar" | "xyzrender-external";
  molstarStyle: "default" | "illustrative";
  xyzFastStyle: "default" | "wire" | "tube" | "spacefill";
};
