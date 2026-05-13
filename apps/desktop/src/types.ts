export type OpenDocumentsResult = {
  documents: ViewerDocument[];
  errors: string[];
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

export type RecentFile = {
  path: string;
  openedAt: number;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isStructureFile: boolean;
  byteCount: number | null;
  modifiedAt: number;
};

export type WorkspaceSearchResult = {
  path: string;
  filename: string;
  relativePath: string;
  score: number;
  matchIndices: number[];
};

export type ShellThemeValues = {
  accent: string;
  background: string;
  foreground: string;
  backgroundOpacity: number;
  contrast: number;
};

export type ViewerPreferences = {
  theme: "auto" | "dark" | "light";
  themeOverrides: {
    light: ShellThemeValues;
    dark: ShellThemeValues;
  };
  canvasBackground: "auto" | "black" | "graphite" | "white" | "transparent";
  rendererMode: "auto" | "xyz-fast" | "molstar" | "xyzrender-external";
  xyzFastStyle: "default" | "wire" | "tube" | "spacefill";
};
