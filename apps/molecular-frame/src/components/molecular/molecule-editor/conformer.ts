export type ConformerRequest = { id: number; molfile: string }
export type ConformerResponse = { id: number; molfile: string } | { id: number; error: string }

const unavailable = 'Could not start 3D. Please try again.'

export function createConformerGenerator() {
  let worker: Worker | null = null
  let sequence = 0
  let disposed = false
  let pending: {
    id: number
    resolve: (molfile: string) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  const stop = (message: string) => {
    const request = pending
    pending = null
    if (request) clearTimeout(request.timer)
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      worker = null
    }
    request?.reject(new Error(message))
  }

  return {
    generate(molfile: string): Promise<string> {
      if (disposed) return Promise.reject(new Error('3D generation was cancelled'))
      if (pending) return Promise.reject(new Error('3D generation is already running'))
      return new Promise((resolve, reject) => {
        const id = ++sequence
        pending = {
          id, resolve, reject,
          timer: setTimeout(() => stop('Building 3D took too long. Please try again.'), 30_000),
        }
        try {
          if (!worker) {
            worker = new Worker(new URL('./conformer-worker.ts', import.meta.url), { type: 'module' })
            worker.onmessage = (event: MessageEvent<ConformerResponse>) => {
              const response = event.data
              if (!pending || response.id !== pending.id) return
              if ('error' in response) {
                stop(response.error)
                return
              }
              const request = pending
              pending = null
              clearTimeout(request.timer)
              request.resolve(response.molfile)
            }
            worker.onerror = event => { event.preventDefault(); stop(unavailable) }
            worker.onmessageerror = () => stop('Could not read the 3D result. Please try again.')
          }
          worker.postMessage({ id, molfile } satisfies ConformerRequest)
        } catch {
          stop(unavailable)
        }
      })
    },
    cancel() { stop('3D generation was cancelled') },
    dispose() { disposed = true; stop('3D generation was cancelled') },
  }
}
