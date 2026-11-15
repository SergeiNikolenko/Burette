export interface MolecularSnapshot {
  molfile: string;
  smiles: string;
  state: {
    tool: string;
    revision: number;
    zoom: number;
    selection: number;
    selectedAtoms: number[];
    selectedBonds: number[];
    empty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    aromatic: boolean;
    cip: boolean;
    hydrogens: boolean;
    cursor: string;
    message: string;
    /** Canvas transform `[scale, x, y]`; changes on pan, zoom and resize. */
    view: [number, number, number];
  };
}
export interface MolecularAtomLayout {
  canvas: { x: number; y: number; width: number; height: number };
  atoms: { x: number; y: number }[];
}
export interface MolecularEditor {
  readonly editor: {
    load(text: string): boolean;
    insert(text: string): void;
    highlightAtoms(indexes: number[]): void;
    setSelection(atoms: number[], bonds: number[]): void;
    getSelectionMolfile(): string;
    getSmiles(): string;
    getMolfile(): string;
    getMolfile3d(): string;
    getSvg(): string;
    getState(): MolecularSnapshot['state'] | null;
    /** Canvas bounds and atom centres (molfile order) in the frame's viewport pixels. */
    getAtomLayout(): MolecularAtomLayout;
    zoom(factor: number): void;
    command(name: string): void;
    setTool(tool: string): void;
  };
  element: HTMLIFrameElement;
  ready: Promise<void>;
  load(text: string): Promise<void>;
  snapshot(): Promise<MolecularSnapshot>;
  svg(): Promise<string>;
  atoms(): Promise<MolecularAtomLayout>;
  setTool(tool: 'hand' | 'select' | 'erase' | 'chain'): Promise<void>;
  command(name: string): Promise<void>;
  setZoom(zoom: number): Promise<void>;
  syncAppearance(): Promise<void>;
  on(name: 'change', listener: (value: Pick<MolecularSnapshot, 'molfile' | 'smiles'>) => void): () => void;
  on(name: 'state', listener: (value: MolecularSnapshot['state']) => void): () => void;
  on(name: 'error', listener: (value: { message: string }) => void): () => void;
  destroy(): void;
}
export function createMolecularEditor(container: HTMLElement, options?: { base?: string | URL; title?: string; onOpenFile?: () => void }): MolecularEditor;
export function readMolecularAppearance(container: HTMLElement): { theme: 'light' | 'dark'; locale: string; variables: Record<string, string> };
