export type BuretteTheme = 'light' | 'dark' | 'auto';
export interface BuretteAppearance {
  locale?: string;
  background?: string;
  foreground?: string;
  accent?: string;
  uiFont?: string;
}

/** One file. Give `data` or a `url` the host page can fetch; `format` defaults to the name's extension. */
export interface BuretteFile {
  name?: string;
  format?: 'pdb' | 'ent' | 'cif' | 'mmcif' | 'bcif' | 'sdf' | 'mol' | 'mol2' | 'pdbqt' | 'xyz' | 'gro';
  data?: ArrayBuffer | ArrayBufferView | Blob | string;
  url?: string;
}

/** Coordinate-only trajectory frames replayed over `structure` as topology. */
export interface BuretteTrajectoryFile extends Omit<BuretteFile, 'format'> {
  format?: 'xtc' | 'trr' | 'dcd' | 'nc' | 'ncdf' | 'nctraj' | 'lammpstrj';
}

export interface BuretteScene {
  /** The structure, the receptor when `poses` is given, or the topology when `trajectory` is given. */
  structure: BuretteFile;
  /** Ligand files shown against the receptor: SDF pose records, or MOL, MOL2 or PDBQT ligands. */
  poses?: BuretteFile | BuretteFile[];
  /** One trajectory, or several XTC segments played in order. Not combined with `poses`. */
  trajectory?: BuretteTrajectoryFile | BuretteTrajectoryFile[];
  /** More structures shown together with `structure` as one scene. Not combined with `poses` or `trajectory`. */
  structures?: BuretteFile | BuretteFile[];
  /** Zero-based pose shown first. */
  activePose?: number;
}

export interface BuretteViewerEvents {
  ready: Record<string, never>;
  /** `file` is the zero-based index into `scene.poses`; in a scene of several structures, the structure's index. */
  pose: { index: number; sourceRecordId: number; count: number; mode: 'single' | 'all'; file: number };
  /** `index` counts frames across all segments. */
  frame: { index: number; playing: boolean; segment: { start: number; count: number } };
  smoothing: { view: 'smoothed' | 'original' };
  selection: { selection: unknown };
  error: { message: string };
  /** Without a listener the file is downloaded by the host page. */
  export: { name: string; mimeType: string; text?: string; base64?: string };
}

export interface BuretteViewer {
  readonly version: string;
  readonly element: HTMLIFrameElement | null;
  /** Resolves when the scene is rendered and interactive. A new scene reloads the frame. */
  open(scene: BuretteScene): Promise<void>;
  setPose(index: number): Promise<unknown>;
  /** Selects a zero-based record in the zero-based pose file (default 0). */
  setPoseRecord(sourceRecordId: number, file?: number): Promise<unknown>;
  /** Shows a zero-based frame of a trajectory or multi-model structure. */
  setFrame(index: number): Promise<unknown>;
  play(): Promise<unknown>;
  pause(): Promise<unknown>;
  /** Smooth motion for multi-model PDB and multi-frame XYZ trajectories. */
  setSmoothing(on: boolean): Promise<unknown>;
  /** One pose or all poses; in a scene of several structures, one structure or all of them. */
  setPoseMode(mode: 'single' | 'all'): Promise<unknown>;
  focusLigand(): Promise<unknown>;
  resetCamera(): Promise<unknown>;
  capture(options?: { width?: number; height?: number; format?: 'png' | 'jpeg' | 'webp'; axes?: boolean; transparent?: boolean }): Promise<{ dataUri: string; width?: number; height?: number }>;
  setTheme(theme: BuretteTheme): Promise<void>;
  setAppearance(appearance: BuretteAppearance): Promise<void>;
  on<K extends keyof BuretteViewerEvents>(name: K, listener: (detail: BuretteViewerEvents[K]) => void): () => void;
  destroy(): void;
}

export function createBuretteViewer(
  container: HTMLElement,
  options?: { base?: string | URL; theme?: BuretteTheme; title?: string; appearance?: BuretteAppearance },
): BuretteViewer;
