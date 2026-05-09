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

export type ViewerPreferences = {
  theme: "auto" | "dark" | "light";
  canvasBackground: "auto" | "black" | "graphite" | "white" | "transparent";
  rendererMode: "auto" | "xyz-fast" | "molstar" | "xyzrender-external";
  xyzFastStyle: "default" | "wire" | "tube" | "spacefill";
};
