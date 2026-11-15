import { useEffect, useEffectEvent, useRef } from 'react'
import type { BuretteViewer, createBuretteViewer } from '../../../../public/burette-embed/burette-embed.js'

export function BuretteView({ molfile, hidden, onError }: { molfile: string; hidden: boolean; onError: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<BuretteViewer | null>(null)
  const reportError = useEffectEvent(onError)
  useEffect(() => {
    let disposed = false
    const element = host.current!
    const url = new URL('burette-embed/burette-embed.js', document.baseURI).href
    const theme = () => document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    const appearance = () => ({
      locale: document.documentElement.lang,
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
      uiFont: getComputedStyle(document.body).fontFamily,
    })
    const observer = new MutationObserver(() => {
      void viewer.current?.setTheme(theme()).catch(reportError)
      void viewer.current?.setAppearance(appearance()).catch(reportError)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'lang'] })
    void (async () => {
      const sdk: { createBuretteViewer: typeof createBuretteViewer } = await import(/* @vite-ignore */ url)
      if (disposed) return
      const instance = sdk.createBuretteViewer(element, { theme: theme(), appearance: appearance() })
      viewer.current = instance
      await instance.open({ structure: { name: 'Molecule.mol', data: molfile } })
    })().catch(() => { if (!disposed) reportError() })
    return () => { disposed = true; observer.disconnect(); viewer.current?.destroy(); viewer.current = null }
  }, [molfile])
  return <div ref={host} className="me-3d" hidden={hidden} />
}
