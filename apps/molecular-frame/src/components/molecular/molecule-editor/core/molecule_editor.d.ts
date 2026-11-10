/* tslint:disable */
/* eslint-disable */

export class Editor {
    free(): void;
    [Symbol.dispose](): void;
    command(name: string): boolean;
    double_click(x: number, y: number): boolean;
    highlight_atoms(indexes: Uint32Array): void;
    insert(text: string): void;
    key(key: string, shift: boolean, primary: boolean, alt: boolean): boolean;
    load(text: string): void;
    molfile_3d(): string;
    molfile(): string;
    constructor();
    pointer_down(x: number, y: number, button: number, shift: boolean, alt: boolean): boolean;
    pointer_leave(): boolean;
    pointer_move(x: number, y: number, buttons: number, shift: boolean, alt: boolean): boolean;
    pointer_up(x: number, y: number): boolean;
    resize(width: number, height: number): void;
    selection_molfile(): string;
    set_selection(atoms: Uint32Array, bonds: Uint32Array): void;
    /**
     * Sets the template for tool `template`. `atom` and `bond` are the
     * 1-based attachment atom and bond, 0 for none.
     */
    set_template(molfile: string, atom: number, bond: number): void;
    set_tool(tool: string): void;
    smiles(): string;
    state(): string;
    svg(): string;
    wheel(x: number, y: number, dx: number, dy: number, zoom: boolean): boolean;
    zoom_by(factor: number): boolean;
}

/**
 * SVG of a molfile fitted into `width` × `height` (no hover, selection or
 * preview), with the editor's classes.
 */
export function thumbnail(molfile: string, width: number, height: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_editor_free: (a: number, b: number) => void;
    readonly editor_command: (a: number, b: number, c: number) => number;
    readonly editor_double_click: (a: number, b: number, c: number) => number;
    readonly editor_highlight_atoms: (a: number, b: number, c: number, d: number) => void;
    readonly editor_insert: (a: number, b: number, c: number, d: number) => void;
    readonly editor_key: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly editor_load: (a: number, b: number, c: number, d: number) => void;
    readonly editor_molfile: (a: number, b: number) => void;
    readonly editor_molfile_3d: (a: number, b: number) => void;
    readonly editor_new: () => number;
    readonly editor_pointer_down: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly editor_pointer_leave: (a: number) => number;
    readonly editor_pointer_move: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly editor_pointer_up: (a: number, b: number, c: number) => number;
    readonly editor_resize: (a: number, b: number, c: number) => void;
    readonly editor_selection_molfile: (a: number, b: number) => void;
    readonly editor_set_selection: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly editor_set_template: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly editor_set_tool: (a: number, b: number, c: number) => void;
    readonly editor_smiles: (a: number, b: number) => void;
    readonly editor_state: (a: number, b: number) => void;
    readonly editor_svg: (a: number, b: number) => void;
    readonly editor_wheel: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly editor_zoom_by: (a: number, b: number) => number;
    readonly thumbnail: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
