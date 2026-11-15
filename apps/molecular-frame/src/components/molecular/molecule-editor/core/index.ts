import init, { Editor, thumbnail } from './molecule_editor.js'

export { Editor, thumbnail }

export type ToolId =
  | 'hand'
  | 'select'
  | 'erase'
  | `bond:${'single' | 'double' | 'triple' | 'wedge' | 'hash' | 'wavy'}`
  | 'chain'
  | 'charge:plus'
  | 'charge:minus'
  | 'rgroup'
  | `rgroup:${number}`
  | 'attach'
  | 'polymer'
  | 'template'
  | `atom:${string}`
  | `ring:${'benzene' | 'cyclopentadiene' | 'cyclohexane' | 'cyclopentane' | 'cyclopropane' | 'cyclobutane' | 'cycloheptane' | 'cyclooctane'}`

export type CommandId =
  | 'undo'
  | 'redo'
  | 'layout'
  | 'clean'
  | 'aromatic'
  | 'cip'
  | 'hydrogens'
  | 'select-all'
  | 'delete'
  | 'clear'
  | 'fit'
  | 'zoom-in'
  | 'zoom-out'
  | 'cancel'

export type EditorState = {
  tool: ToolId
  canUndo: boolean
  canRedo: boolean
  aromatic: boolean
  cip: boolean
  hydrogens: boolean
  empty: boolean
  selection: number
  selectedAtoms: number[]
  selectedBonds: number[]
  cursor: string
  revision: number
  /** Percent of the natural scale (100: labels at about 15.6 px). */
  zoom: number
  /** Why the last command or action could not run; '' when there is nothing to report. */
  message: string
}

let ready: Promise<typeof Editor> | undefined

/** Resolves once the module is instantiated; `thumbnail` works from then on. */
export function loadEditorCore(): Promise<typeof Editor> {
  return ready ??= init().then(() => Editor).catch(error => {
    ready = undefined
    throw error
  })
}
