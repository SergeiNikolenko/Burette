import type { loadEditorCore } from './core'

let core: ReturnType<typeof loadEditorCore> | undefined

// One shared download of the editor core; a failed attempt can be retried.
export function loadCore() {
  core ??= import('./core').then(module => module.loadEditorCore()).catch(error => {
    core = undefined
    throw error
  })
  return core
}

// Warm only the adapter on navigation intent; the chemistry core waits for use.
export function preloadMoleculeEditor() {
  import('./index').catch(() => {})
}
