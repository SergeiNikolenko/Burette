import { useLocale } from "@/components/locale-provider"
import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type ClipboardEvent, type PointerEvent, type Ref } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CommandId, Editor, EditorState, ToolId } from './core'
import { loadCore } from './preload'
import { BottomPanel, LeftPanel, mac, RightPanel, ToolbarLayout, TopPanel, ZoomPanel } from './toolbar'
import type { Fragment } from './library'
import { createConformerGenerator } from './conformer'
import './molecule-editor.css'

const BuretteView = lazy(() => import('./burette-view').then(module => ({ default: module.BuretteView })))
type Position = { x: number; y: number }
type Move = Position & { buttons: number; shift: boolean; alt: boolean }
type Gesture = Position & { distance: number }

function touchGesture(points: Iterable<Position>): Gesture | null {
  const [a, b] = points
  return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) } : null
}

export type MoleculeEditorHandle = {
  load(text: string): boolean
  insert(text: string): void
  highlightAtoms(indexes: number[]): void
  setSelection(atoms: number[], bonds: number[]): void
  getSelectionMolfile(): string
  getSmiles(): string
  getMolfile(): string
  getMolfile3d(): string
  getSvg(): string
  getState(): EditorState | null
  zoom(factor: number): void
  command(name: CommandId): void
  setTool(tool: ToolId): void
}

type MoleculeEditorProps = {
  ref?: Ref<MoleculeEditorHandle>
  defaultValue?: string
  onChange?: (value: { smiles: string; molfile: string }) => void
  onReady?: () => void
  onOpenFile?: () => void
  onPending?: () => void
  onError?: (message: string) => void
  onStateChange?: (state: EditorState) => void
  className?: string
}

const unreadable = 'Could not read this structure. Check the SMILES or molfile.'
const eraseCursor = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="5" fill="none" stroke="white" stroke-width="4"/>
  <circle cx="16" cy="16" r="5" fill="none" stroke="#262626" stroke-width="1.5"/>
  <path d="m23 21 6 6-3 3h-4l-3-3z" fill="white" stroke="white" stroke-width="4" stroke-linejoin="round"/>
  <path d="m23 21 6 6-3 3h-4l-3-3z m-2 4 5 5" fill="white" stroke="#262626" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`)}") 16 16, crosshair`
const conformerMessages = new Map([
  ['Draw a structure first', 'Draw a structure first'],
  ['Fix the highlighted atoms to build 3D', 'Fix the highlighted atoms to build 3D'],
  ['Too large for the 3D view', 'This structure is too large for 3D. Try a smaller fragment.'],
  ['Could not read this structure.', 'Check atom types and R-groups before opening 3D.'],
  ['Could not start 3D. Please try again.', 'Could not start 3D. Please try again.'],
  ['Building 3D took too long. Please try again.', 'Building 3D took too long. Please try again.'],
  ['Could not read the 3D result. Please try again.', 'Could not read the 3D result. Please try again.'],
])

function point(host: HTMLElement, event: { clientX: number; clientY: number }) {
  const rect = host.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top] as const
}

const coreRevision = (instance: Editor) => (JSON.parse(instance.state()) as EditorState).revision

export function MoleculeEditor({ ref, defaultValue = '', onChange, onReady, onOpenFile, onPending, onError, onStateChange, className }: MoleculeEditorProps) {
  const { t: mt } = useLocale()
  const root = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const drawing = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor | null>(null)
  const frame = useRef(0)
  const dirty = useRef(false)
  const pendingMove = useRef<Move | null>(null)
  const touches = useRef(new Map<number, Position>())
  const gesture = useRef<Gesture | null>(null)
  const gesturing = useRef(false)
  const activePointer = useRef<number | null>(null)
  const snapshot = useRef('')
  const painted = useRef('')
  const initial = useRef(defaultValue)
  const built = useRef(-1)
  const conformer = useRef<ReturnType<typeof createConformerGenerator> | null>(null)
  const buildRequest = useRef(0)
  const [state, setState] = useState<EditorState | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState('')
  const [view3d, setView3d] = useState(false)
  const [computing, setComputing] = useState(false)
  const [molfile3d, setMolfile3d] = useState('')
  const [fullscreen, setFullscreen] = useState<HTMLElement>()
  const [maximized, setMaximized] = useState(false)
  const [compact, setCompact] = useState(false)
  const callbacks = useRef({ onReady, onPending, onError, onStateChange })
  callbacks.current = { onReady, onPending, onError, onStateChange }
  const notifiedRevision = useRef<number | null>(null)

  const flushMove = useCallback(() => {
    const instance = editor.current
    if (!instance) return false
    const previous = gesture.current
    if (gesturing.current && previous) {
      const next = touchGesture(touches.current.values())
      if (!next) return false
      gesture.current = next
      if (next.x === previous.x && next.y === previous.y && next.distance === previous.distance) return false
      instance.wheel(previous.x, previous.y, 0, 500 * Math.log(previous.distance / next.distance), true)
      instance.wheel(next.x, next.y, previous.x - next.x, previous.y - next.y, false)
      return true
    }
    const move = pendingMove.current
    pendingMove.current = null
    return !!move && instance.pointer_move(move.x, move.y, move.buttons, move.shift, move.alt)
  }, [])

  // Input methods report whether the drawing needs a repaint; repaints share one frame.
  const render = useCallback((force = true) => {
    if (editor.current) {
      const revision = coreRevision(editor.current)
      if (notifiedRevision.current !== null && revision !== notifiedRevision.current) callbacks.current.onPending?.()
      notifiedRevision.current = revision
    }
    dirty.current ||= force
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (!editor.current || !drawing.current || !host.current) return
      const moved = flushMove()
      if (!dirty.current && !moved) return
      const revision = coreRevision(editor.current)
      if (notifiedRevision.current !== null && revision !== notifiedRevision.current) callbacks.current.onPending?.()
      notifiedRevision.current = revision
      dirty.current = false
      const svg = editor.current.svg()
      if (svg !== painted.current) {
        drawing.current.innerHTML = svg
        painted.current = svg
      }
      const json = editor.current.state()
      if (json === snapshot.current) return
      snapshot.current = json
      const next: EditorState = JSON.parse(json)
      host.current.style.cursor = next.tool === 'erase' ? eraseCursor : next.cursor
      setState(next)
      callbacks.current.onStateChange?.(next)
    })
  }, [flushMove])

  const focus = useCallback(() => host.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    let disposed = false
    let instance: Editor | undefined
    loadCore().then(EditorCore => {
      if (disposed || !host.current) return
      instance = new EditorCore()
      instance.resize(host.current.clientWidth, host.current.clientHeight)
      let loaded = true
      try {
        if (initial.current) instance.load(initial.current)
      } catch {
        setStatus(unreadable)
        loaded = false
        callbacks.current.onError?.(unreadable)
      }
      editor.current = instance
      render()
      if (loaded) callbacks.current.onReady?.()
    }, () => { if (!disposed) { setFailed(true); callbacks.current.onError?.('Could not open the editor') } })
    return () => {
      disposed = true
      cancelAnimationFrame(frame.current)
      frame.current = 0
      snapshot.current = ''
      painted.current = ''
      pendingMove.current = null
      touches.current.clear()
      gesture.current = null
      gesturing.current = false
      activePointer.current = null
      buildRequest.current++
      conformer.current?.dispose()
      conformer.current = null
      editor.current = null
      notifiedRevision.current = null
      instance?.free()
    }
  }, [attempt, render])

  useEffect(() => {
    const node = host.current!
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!editor.current || !width || !height) return
      editor.current.resize(width, height)
      render()
    })
    const layout = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width <= 600))
    // Native listener: React registers wheel handlers as passive.
    const wheel = (event: WheelEvent) => {
      if (!editor.current) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
      const [x, y] = point(node, event)
      flushMove()
      if (!editor.current.wheel(x, y, event.deltaX * scale, event.deltaY * scale, event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      render()
    }
    resize.observe(node)
    layout.observe(root.current!)
    node.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      layout.disconnect()
      node.removeEventListener('wheel', wheel)
    }
  }, [flushMove, render])

  useEffect(() => {
    const update = () => setFullscreen(root.current && document.fullscreenElement === root.current ? root.current : undefined)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  useEffect(() => {
    if (!maximized) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [maximized])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 3000)
    return () => clearTimeout(timer)
  }, [status])

  const emit = useEffectEvent(() => {
    if (editor.current && onChange) {
      try { onChange({ smiles: editor.current.smiles(), molfile: editor.current.molfile() }) }
      catch { callbacks.current.onError?.('Could not read this structure') }
    }
  })
  const revision = state?.revision
  const loadedRevision = useRef<number>(undefined)
  useEffect(() => {
    if (revision === undefined) return
    loadedRevision.current ??= revision
    if (revision === loadedRevision.current) return
    const timer = setTimeout(emit, 150)
    return () => clearTimeout(timer)
  }, [revision])

  const invalidate3d = useCallback(() => {
    buildRequest.current++
    conformer.current?.cancel()
    built.current = -1
    setMolfile3d('')
    setComputing(false)
    setView3d(false)
  }, [])

  const load = useCallback((text: string) => {
    if (!editor.current) {
      initial.current = text
      return false
    }
    try {
      pendingMove.current = null
      editor.current.load(text)
      invalidate3d()
      setStatus('')
      render()
      return true
    } catch {
      setStatus(unreadable)
      callbacks.current.onError?.(unreadable)
      return false
    }
  }, [invalidate3d, render])

  const onCommand = useCallback((name: CommandId) => {
    pendingMove.current = null
    const instance = editor.current
    if (instance) {
      const before = coreRevision(instance)
      instance.command(name)
      if (coreRevision(instance) !== before) invalidate3d()
    }
    render()
    focus()
  }, [focus, invalidate3d, render])

  useImperativeHandle(ref, () => ({
    load,
    insert(text) {
      if (!editor.current) throw new Error('The editor is still loading')
      editor.current.insert(text)
      invalidate3d()
      render()
    },
    highlightAtoms(indexes) {
      if (!editor.current) throw new Error('The editor is still loading')
      if (indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index > 0xffffffff)) throw new Error('Invalid atom index')
      editor.current.highlight_atoms(new Uint32Array(indexes))
      render()
    },
    setSelection(atoms, bonds) {
      if (!editor.current) throw new Error('The editor is still loading')
      if ([...atoms, ...bonds].some(index => !Number.isSafeInteger(index) || index < 0 || index > 0xffffffff)) throw new Error('Invalid selection index')
      editor.current.set_selection(new Uint32Array(atoms), new Uint32Array(bonds))
      render()
    },
    getSelectionMolfile: () => { if (!editor.current) throw new Error('The editor is still loading'); return editor.current.selection_molfile() },
    getSmiles: () => { if (!editor.current) throw new Error('The editor is still loading'); return editor.current.smiles() },
    getMolfile: () => { if (!editor.current) throw new Error('The editor is still loading'); return editor.current.molfile() },
    getState: () => editor.current ? JSON.parse(editor.current.state()) as EditorState : null,
    getSvg: () => {
      if (editor.current && drawing.current) drawing.current.innerHTML = editor.current.svg()
      const source = drawing.current?.querySelector('svg')
      if (!source || !editor.current) throw new Error('The editor is still loading')
      const clone = source.cloneNode(true) as SVGSVGElement
      const originals = [source, ...source.querySelectorAll('*')]
      const copies = [clone, ...clone.querySelectorAll('*')]
      originals.forEach((node, index) => {
        const style = getComputedStyle(node)
        for (const property of ['fill', 'stroke', 'color', 'font-family', 'font-size', 'font-weight', 'opacity']) copies[index].setAttribute(property, style.getPropertyValue(property))
      })
      clone.querySelectorAll('.me-hover, .me-selected, .me-preview, .me-marquee, [data-atom-id]').forEach(node => node.remove())
      return new XMLSerializer().serializeToString(clone)
    },
    zoom: (factor: number) => {
      if (!editor.current || !host.current || !Number.isFinite(factor) || factor <= 0) return
      editor.current.zoom_by(factor)
      render()
    },
    getMolfile3d: () => {
      if (!editor.current) throw new Error('The editor is still loading')
      return editor.current.molfile_3d()
    },
    command: onCommand,
    setTool: (tool: ToolId) => { editor.current?.set_tool(tool); render() },
  }), [load, onCommand, render])

  const onTool = useCallback((tool: ToolId) => {
    pendingMove.current = null
    editor.current?.set_tool(tool)
    render()
    focus()
  }, [focus, render])

  const onTemplate = useCallback((fragment: Fragment) => {
    if (!editor.current) return false
    try {
      pendingMove.current = null
      editor.current.set_template(fragment.molfile, fragment.atom, fragment.bond)
      editor.current.set_tool('template')
      setStatus('')
      render()
      focus()
      return true
    } catch {
      setStatus('Could not open this fragment')
      return false
    }
  }, [focus, render])

  // A module worker keeps drawing and navigation responsive during 3D generation.
  const on3d = useCallback(() => {
    if (view3d) {
      buildRequest.current++
      conformer.current?.cancel()
      setComputing(false)
      setView3d(false)
      requestAnimationFrame(focus)
      return
    }
    const instance = editor.current
    if (!instance) return
    if (/^A  /m.test(instance.molfile())) { setStatus('Replace variable atoms before building 3D'); return }
    const sourceRevision = coreRevision(instance)
    setView3d(true)
    if (built.current === sourceRevision) return
    const request = ++buildRequest.current
    const isCurrent = () => {
      if (request !== buildRequest.current || editor.current !== instance) return false
      if (coreRevision(instance) === sourceRevision) return true
      invalidate3d()
      return false
    }
    setComputing(true)
    conformer.current ??= createConformerGenerator()
    conformer.current.generate(instance.molfile()).then(molfile => {
      if (!isCurrent()) return
      try {
        if (molfile.length > 350_000) throw new Error('Too large for the 3D view')
        built.current = sourceRevision
        setMolfile3d(molfile)
        setStatus('')
      } catch (error) {
        setView3d(false)
        setStatus(error instanceof Error && conformerMessages.get(error.message) || 'Could not build 3D. Try another structure or adjust the drawing.')
      }
    }, error => {
      if (!isCurrent()) return
      setView3d(false)
      setStatus(error instanceof Error && conformerMessages.get(error.message) || 'Could not build 3D. Try another structure or adjust the drawing.')
    }).finally(() => { if (request === buildRequest.current) setComputing(false) })
  }, [focus, invalidate3d, view3d])

  const on3dError = useCallback(() => {
    setView3d(false)
    setMolfile3d('')
    built.current = -1
    setStatus('Could not open the 3D view')
  }, [])

  const onFullscreen = useCallback(() => {
    if (maximized) { setMaximized(false); return }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return }
    if (root.current?.requestFullscreen) root.current.requestFullscreen().catch(() => setMaximized(true))
    else setMaximized(true)
  }, [maximized])

  const pointer = (event: { currentTarget: HTMLDivElement; clientX: number; clientY: number }) => point(event.currentTarget, event)
  const stopPointer = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const known = touches.current.has(event.pointerId)
    if (event.pointerId !== activePointer.current && !known) return
    if (gesturing.current) {
      flushMove()
      touches.current.delete(event.pointerId)
      gesture.current = touchGesture(touches.current.values())
      if (!touches.current.size) gesturing.current = false
    } else {
      if (cancel) {
        pendingMove.current = null
        editor.current?.command('cancel')
      } else {
        flushMove()
        editor.current?.pointer_up(...pointer(event))
      }
      touches.current.delete(event.pointerId)
      if (event.pointerType === 'touch') editor.current?.pointer_leave()
    }
    if (event.pointerId === activePointer.current) activePointer.current = null
    render()
  }
  const copy = (event: ClipboardEvent) => {
    if (!editor.current || !state?.selection) return false
    const molfile = editor.current.selection_molfile()
    event.clipboardData.setData('text/plain', molfile)
    event.clipboardData.setData('chemical/x-mdl-molfile', molfile)
    event.preventDefault()
    return true
  }

  const expanded = !!fullscreen || maximized
  const overlayContainer = fullscreen ?? (maximized ? root.current ?? undefined : undefined)
  return <div ref={root} data-view={view3d ? '3d' : '2d'} data-compact={compact || undefined} data-expanded={maximized || undefined} className={cn('me-root', className)} onKeyDown={event => { if (maximized && event.key === 'Escape') setMaximized(false) }}>
    <div
      ref={host}
      tabIndex={0}
      role="application"
      aria-label={mt("Structure canvas")}
      inert={view3d}
      className="me-host"
      onPointerDown={event => {
        if (!editor.current) return
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        if (event.pointerType === 'touch') {
          const [x, y] = pointer(event)
          touches.current.set(event.pointerId, { x, y })
          if (touches.current.size > 1) {
            pendingMove.current = null
            if (!gesturing.current) editor.current.command('cancel')
            gesturing.current = true
            gesture.current = touchGesture(touches.current.values())
            render()
            return
          }
          if (gesturing.current) return
        }
        pendingMove.current = null
        activePointer.current = event.pointerId
        if (editor.current.pointer_down(...pointer(event), event.button, event.shiftKey, event.altKey)) render()
      }}
      onPointerMove={event => {
        if (!editor.current) return
        const [x, y] = pointer(event)
        if (event.pointerType === 'touch') {
          if (!touches.current.has(event.pointerId)) return
          touches.current.set(event.pointerId, { x, y })
          if (gesturing.current) { render(false); return }
        }
        // Erasing keeps every sampled point so a fast stroke cannot skip atoms.
        if (state?.tool === 'erase' && event.buttons) {
          if (editor.current.pointer_move(x, y, event.buttons, event.shiftKey, event.altKey)) render()
          return
        }
        pendingMove.current = { x, y, buttons: event.buttons, shift: event.shiftKey, alt: event.altKey }
        render(false)
      }}
      onPointerUp={event => stopPointer(event)}
      onPointerCancel={event => stopPointer(event, true)}
      onLostPointerCapture={event => stopPointer(event, true)}
      onPointerLeave={() => { if (activePointer.current === null) pendingMove.current = null; if (editor.current?.pointer_leave()) render() }}
      onDoubleClick={event => { if (editor.current?.double_click(...pointer(event))) render() }}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        const primary = mac ? event.metaKey : event.ctrlKey
        // Copy, cut and paste arrive as clipboard events.
        if (!editor.current || (primary && /^[cvx]$/i.test(event.key))) return
        pendingMove.current = null
        if (!editor.current.key(event.key, event.shiftKey, primary, event.altKey)) return
        event.preventDefault()
        render()
      }}
      onCopy={copy}
      onCut={event => { if (copy(event) && editor.current?.command('delete')) render() }}
      onPaste={event => {
        const text = event.clipboardData.getData('text/plain')
        if (!editor.current || !text.trim()) return
        event.preventDefault()
        try {
          editor.current.insert(text)
          render()
        } catch {
          setStatus(unreadable)
        }
      }}
    >
      <div ref={drawing} className="me-drawing" />
    </div>
    {molfile3d && <Suspense fallback={view3d ? <div className="me-center" role="status" aria-label={mt("Opening 3D")}><Spinner aria-hidden="true" className="size-5 motion-reduce:animate-none" /></div> : null}><BuretteView molfile={molfile3d} hidden={!view3d} onError={on3dError} /></Suspense>}
    {state && <ToolbarLayout value={compact}><TooltipProvider>
      <TopPanel state={state} view3d={view3d} fullscreen={expanded} container={overlayContainer} onCommand={onCommand} on3d={on3d} onFullscreen={onFullscreen} onOpenFile={onOpenFile} />
      {!view3d && <>
        {/* Narrow editors join the drawing panels into one row that scrolls sideways. */}
        <div className="me-dock">
          <LeftPanel tool={state.tool} onTool={onTool} container={overlayContainer} finalFocus={host} />
          <RightPanel tool={state.tool} onTool={onTool} container={overlayContainer} finalFocus={host} />
          <BottomPanel tool={state.tool} onTool={onTool} container={overlayContainer} finalFocus={host} onTemplate={onTemplate} />
        </div>
        <ZoomPanel zoom={state.zoom ?? 100} onCommand={onCommand} />
      </>}
    </TooltipProvider></ToolbarLayout>}
    {failed
      ? <div className="me-center"><Button variant="outline" size="sm" onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>{mt("Retry")}</Button></div>
      : (!state || computing) && <div className="me-center" role="status" aria-label={mt("Loading")}><Spinner aria-hidden="true" className="size-5 motion-reduce:animate-none" /></div>}
    <div role="status" className="me-status">{mt(status || state?.message || "")}</div>
  </div>
}
