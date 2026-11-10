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

export interface BuretteScene {
  /** The structure, or the receptor when `poses` is given. */
  structure: BuretteFile;
  /** SDF pose records, or one MOL, MOL2 or PDBQT ligand, shown against the receptor. */
  poses?: BuretteFile;
  /** Zero-based pose shown first. */
  activePose?: number;
}

export interface BuretteViewerEvents {
  ready: Record<string, never>;
  pose: { index: number; sourceRecordId: number; count: number; mode: 'single' | 'all' };
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
  /** Selects a zero-based record in the supplied docking pose file. */
  setPoseRecord(sourceRecordId: number): Promise<unknown>;
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
