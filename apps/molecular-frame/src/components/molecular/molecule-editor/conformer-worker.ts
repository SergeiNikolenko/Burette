import { loadEditorCore, type Editor } from './core'
import type { ConformerRequest, ConformerResponse } from './conformer'

// The existing core resolves the same hashed WASM URL as the 2D editor.
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<ConformerRequest>) => void
  postMessage: (message: ConformerResponse) => void
}

worker.onmessage = async ({ data: { id, molfile } }) => {
  let editor: Editor | undefined
  try {
    const EditorCore = await loadEditorCore().catch(() => {
      throw new Error('Could not start 3D. Please try again.')
    })
    editor = new EditorCore()
    editor.load(molfile)
    worker.postMessage({ id, molfile: editor.molfile_3d() })
  } catch (error) {
    worker.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  } finally {
    editor?.free()
  }
}
