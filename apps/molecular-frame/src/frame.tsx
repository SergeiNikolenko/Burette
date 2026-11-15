import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MoleculeEditor, type MoleculeEditorHandle } from './components/molecular/molecule-editor'
import { MolecularLocale } from './components/locale-provider'
import './frame.css'

const hostOrigin = new URLSearchParams(location.search).get('hostOrigin')
  ?? document.querySelector<HTMLMetaElement>('meta[name="burette-host-origin"]')?.content
const safeOrigin = hostOrigin === 'null' ? 'null' : hostOrigin && URL.canParse(hostOrigin) ? hostOrigin : null
const send = (type: string, value: unknown) => {
  if (safeOrigin) parent.postMessage({ source: 'burette-molecular-frame', type, value }, safeOrigin === 'null' ? '*' : safeOrigin)
}
const variables = ['background', 'foreground', 'popover', 'muted', 'muted-foreground', 'accent', 'border', 'destructive', 'font-sans']
declare global { interface Window { BuretteMolecularEditor?: MoleculeEditorHandle } }

function Frame() {
  const editor = useRef<MoleculeEditorHandle>(null)
  const [locale, setLocale] = useState('en')
  const [ready, setReady] = useState(false)
  const [canOpenFile, setCanOpenFile] = useState(false)
  useEffect(() => {
    if (ready && editor.current) window.BuretteMolecularEditor = editor.current
    const receive = (event: MessageEvent) => {
      const message = event.data
      if (!safeOrigin || event.source !== parent || event.origin !== safeOrigin || message?.source !== 'burette-molecular-host') return
      const result = (value: unknown) => send('result', { id: message.id, ok: true, value })
      try {
        if (message.command === 'appearance') {
          document.documentElement.classList.toggle('dark', message.value.theme === 'dark')
          for (const key of variables) {
            const value = message.value.variables?.[key]
            if (typeof value === 'string' && value.length <= 256 && CSS.supports(key === 'font-sans' ? 'font-family' : 'color', value)) document.documentElement.style.setProperty(`--${key}`, value)
            else document.documentElement.style.removeProperty(`--${key}`)
          }
          const language = /^ru(?:-|$)/i.test(message.value.locale ?? '') ? 'ru' : 'en'
          document.documentElement.lang = language
          setLocale(language)
          setCanOpenFile(message.value.openFile === true)
          result(null)
          return
        }
        if (!ready || !editor.current) throw new Error('The editor is loading')
        switch (message.command) {
          case 'load': {
            if (typeof message.value !== 'string' || message.value.length > 2_000_000) throw new Error('Structure exceeds the supported size')
            if (!editor.current.load(message.value)) throw new Error('Could not read this structure')
            result(null)
            break
          }
          case 'snapshot': result({ molfile: editor.current.getMolfile(), smiles: editor.current.getSmiles(), state: editor.current.getState() }); break
          case 'svg': result(editor.current.getSvg()); break
          case 'zoom': {
            if (typeof message.value !== 'number' || !Number.isFinite(message.value) || message.value <= 0) throw new Error('Invalid zoom')
            const zoom = editor.current.getState()?.zoom ?? 100
            editor.current.zoom(message.value * 100 / zoom)
            result(null)
            break
          }
          case 'command': {
            if (!['undo', 'redo', 'layout', 'clean', 'aromatic', 'cip', 'hydrogens', 'select-all', 'delete', 'clear', 'fit', 'zoom-in', 'zoom-out', 'cancel'].includes(message.value)) throw new Error('Unknown editor command')
            editor.current.command(message.value)
            result(null)
            break
          }
          default: throw new Error('Unknown frame command')
        }
      } catch (error) {
        send('result', { id: message.id, ok: false, error: error instanceof Error ? error.message : 'Editor operation failed' })
      }
    }
    window.addEventListener('message', receive)
    if (ready) send('ready', {})
    return () => { window.removeEventListener('message', receive); delete window.BuretteMolecularEditor }
  }, [ready])
  return <MolecularLocale value={locale}><MoleculeEditor ref={editor}
    onOpenFile={canOpenFile ? () => send('openFile', {}) : undefined}
    onReady={() => setReady(true)} onChange={value => send('change', value)}
    onStateChange={value => send('state', value)} onError={message => send('error', { message })} /></MolecularLocale>
}

createRoot(document.getElementById('root')!).render(<Frame />)
