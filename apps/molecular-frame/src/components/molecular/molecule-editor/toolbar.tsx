import { useLocale } from "@/components/locale-provider"
import { createContext, lazy, memo, Suspense, use, useState, type ComponentProps, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ArrowLeftIcon, BoxIcon, ChevronDownIcon, EraserIcon, HandIcon, LibraryBigIcon, MaximizeIcon, MinimizeIcon, MinusIcon, MousePointer2Icon, PlusIcon, Redo2Icon, Undo2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Popover, PopoverContent, PopoverItem, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CommandId, EditorState, ToolId } from './core'
import { AromaticIcon, AttachIcon, BondIcon, ChainIcon, ChargeIcon, CleanIcon, ElementsIcon, HydrogensIcon, LayoutIcon, PolymerIcon, RGroupIcon, RingIcon, rings, StereoIcon, type BondType, type Ring } from './icons'
import { elements } from './elements'
import { moveFocus } from './focus'
import type { Fragment } from './library'

const FragmentLibrary = lazy(() => import('./library').then(module => ({ default: module.FragmentLibrary })))

export const mac = /Mac|iPhone|iPad/.test(navigator.userAgent)

const bonds: [BondType, string, string?][] = [
  ['single', 'Single', '1'], ['double', 'Double', '2'], ['triple', 'Triple', '3'],
  ['wedge', 'Wedge'], ['hash', 'Hash'], ['wavy', 'Wavy'],
]
const atoms: [string, string, string?][] = [
  ['H', 'Hydrogen'], ['C', 'Carbon'], ['N', 'Nitrogen'], ['O', 'Oxygen'], ['S', 'Sulfur'],
  ['P', 'Phosphorus'], ['F', 'Fluorine'], ['Cl', 'Chlorine', 'L'], ['Br', 'Bromine', 'B'], ['I', 'Iodine'],
]

type Edge = 'top' | 'right' | 'bottom' | 'left'
const facing = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
const Overlay = createContext<{ side: Edge; container?: HTMLElement }>({ side: 'bottom' })
export const ToolbarLayout = createContext(false)

// Arrow keys move focus along a panel, wrapping at the ends.
function navigate(event: KeyboardEvent<HTMLDivElement>) {
  if (event.defaultPrevented) return
  moveFocus(event)
}

function Panel({ edge, label, container, children }: { edge: Edge; label: string; container?: HTMLElement; children: ReactNode }) {
  const { t: mt } = useLocale()
  const compact = use(ToolbarLayout)
  const vertical = !compact && (edge === 'left' || edge === 'right')
  const side = compact ? edge === 'top' ? 'bottom' : 'top' : facing[edge]
  return <Overlay value={{ side, container }}>
    <div role="toolbar" aria-label={mt(label)} aria-orientation={vertical ? 'vertical' : 'horizontal'} data-edge={edge} className="me-panel" onPointerDown={event => event.stopPropagation()} onKeyDown={navigate}>{children}</div>
  </Overlay>
}

const Divider = () => <span aria-hidden="true" className="me-divider" />

type ToolButtonProps = ComponentProps<typeof Button> & { label: string; shortcut?: string; hideTooltip?: boolean }

function ToolButton({ label, shortcut, hideTooltip, className, ...props }: ToolButtonProps) {
  const { t: mt } = useLocale()
  const { side, container } = use(Overlay)
  return <Tooltip disabled={hideTooltip} disableHoverablePopup>
    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={mt(label)} className={cn('me-tool', className)} {...props} />} />
    <TooltipContent variant="surface" side={side} sideOffset={6} container={container} shortcut={shortcut}>{mt(label)}</TooltipContent>
  </Tooltip>
}

type ToolProps = { tool: ToolId; onTool: (tool: ToolId) => void }

function Tool({ id, tool, onTool, ...props }: ToolProps & ToolButtonProps & { id: ToolId }) {
  return <ToolButton aria-pressed={tool === id} onClick={() => onTool(id)} {...props} />
}

// Select the last bond type; pressing it again or its corner opens the picker.
function BondTool({ tool, onTool, finalFocus }: ToolProps & { finalFocus: RefObject<HTMLElement | null> }) {
  const { t: mt } = useLocale()
  const { container } = use(Overlay)
  const compact = use(ToolbarLayout)
  const [bond, setBond] = useState<BondType>('single')
  const [open, setOpen] = useState(false)
  const active = tool.startsWith('bond:') ? tool.slice(5) as BondType : undefined
  if (active && active !== bond) setBond(active)
  const [, name, key] = bonds.find(([type]) => type === bond)!
  return <div className="me-split">
    <ToolButton label={mt(`${name} bond`)} shortcut={key} hideTooltip={open} aria-pressed={!!active} aria-haspopup="dialog" aria-expanded={open} onClick={() => active ? setOpen(true) : onTool(`bond:${bond}`)} onContextMenu={event => { event.preventDefault(); setOpen(true) }}><BondIcon type={bond} /></ToolButton>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={mt("Bond types")} className="me-more"><ChevronDownIcon /></PopoverTrigger>
      <PopoverContent aria-label={mt("Bond types")} side={compact ? 'top' : 'right'} align="start" sideOffset={10} variant="menu" container={container} finalFocus={finalFocus} className="me-popup w-40">
        {bonds.map(([type, name, key]) => <PopoverItem key={type} onClick={() => onTool(`bond:${type}`)}>
          <BondIcon type={type} />{mt(name)}{key && <span className="atlas-menu-shortcut">{key}</span>}
        </PopoverItem>)}
      </PopoverContent>
    </Popover>
  </div>
}

type TopProps = {
  state: EditorState; view3d: boolean; fullscreen: boolean; container?: HTMLElement
  onCommand: (command: CommandId) => void; on3d: () => void; onFullscreen: () => void
  onOpenFile?: () => void
}

export const TopPanel = memo(function TopPanel({ state, view3d, fullscreen, container, onCommand, on3d, onFullscreen, onOpenFile }: TopProps) {
  const { t: mt } = useLocale()
  const command = (id: CommandId, label: string, icon: ReactNode, extra?: Partial<ToolButtonProps>) =>
    <ToolButton label={label} disabled={view3d} onClick={() => onCommand(id)} {...extra}>{icon}</ToolButton>
  return <Panel edge="top" label={view3d ? '3D view' : 'Structure'} container={container}>
    {onOpenFile && <Button variant="ghost" size="sm" onClick={onOpenFile}>{mt('Open')}</Button>}
    {view3d ? <Button variant="ghost" size="sm" aria-label={mt("Back to 2D")} className="me-back h-7 gap-1.5 px-2" onClick={on3d}><ArrowLeftIcon className="size-4" /><span className="me-back-label">{mt("Back to 2D")}</span></Button> : <>
    {command('undo', 'Undo', <Undo2Icon />, { shortcut: mac ? '⌘Z' : 'Ctrl+Z', disabled: view3d || !state.canUndo })}
    {command('redo', 'Redo', <Redo2Icon />, { shortcut: mac ? '⇧⌘Z' : 'Ctrl+Shift+Z', disabled: view3d || !state.canRedo })}
    <Divider />
    {command('layout', 'Layout', <LayoutIcon />, { disabled: view3d || state.empty })}
    {command('clean', 'Clean up', <CleanIcon />, { disabled: view3d || state.empty })}
    {command('aromatic', 'Aromatic', <AromaticIcon />, { 'aria-pressed': state.aromatic })}
    {command('cip', 'Stereo labels', <StereoIcon />, { 'aria-pressed': state.cip })}
    {command('hydrogens', 'Explicit hydrogens', <HydrogensIcon />, { 'aria-pressed': state.hydrogens })}
    <Divider />
    <ToolButton label={mt("3D view")} aria-pressed={view3d} disabled={!view3d && state.empty} onClick={on3d}><BoxIcon /></ToolButton>
    </>}
    <>
      <Divider />
      <ToolButton label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={onFullscreen}>{fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}</ToolButton>
    </>
  </Panel>
})

type SideProps = ToolProps & { container?: HTMLElement }

function GroupTool({ tool, onTool, finalFocus }: ToolProps & { finalFocus: RefObject<HTMLElement | null> }) {
  const { t: mt } = useLocale()
  const { container } = use(Overlay)
  const compact = use(ToolbarLayout)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ToolId>('rgroup:1')
  const active = tool.startsWith('rgroup') || tool === 'atom:*' || tool === 'attach' || tool === 'polymer'
  const select = (id: ToolId) => { setCurrent(id); onTool(id); setOpen(false) }
  const numbered = current.startsWith('rgroup:') ? current.slice(7) : ''
  return <div className="me-split">
    <ToolButton hideTooltip={open} label={current === 'attach' ? 'Attachment point' : current === 'polymer' ? 'Polymer repeat unit' : `${mt("R-group")} ${numbered}`} aria-pressed={active} aria-haspopup="dialog" aria-expanded={open} onClick={() => active ? setOpen(true) : onTool(current)} onContextMenu={event => { event.preventDefault(); setOpen(true) }}>
      {current === 'attach' ? <AttachIcon /> : current === 'polymer' ? <PolymerIcon /> : numbered ? <span className="text-xs">R<sub>{numbered}</sub></span> : <RGroupIcon />}
    </ToolButton>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={mt("R-groups and polymers")} className="me-more"><ChevronDownIcon /></PopoverTrigger>
      <PopoverContent aria-label={mt("R-groups and polymers")} side={compact ? 'top' : 'right'} align={compact ? 'start' : 'end'} sideOffset={10} container={container} finalFocus={finalFocus} className="me-popup w-64 gap-2">
        <div className="grid grid-cols-4 gap-1" onKeyDown={event => moveFocus(event)}>
          {Array.from({ length: 8 }, (_, index) => <Button key={index} variant="ghost" size="sm" aria-pressed={tool === `rgroup:${index + 1}`} onClick={() => select(`rgroup:${index + 1}`)}>R{index + 1}</Button>)}
        </div>
        <PopoverItem onClick={() => select('atom:*')}><RGroupIcon />{mt("Any group")}</PopoverItem>
        <PopoverItem onClick={() => select('attach')}><AttachIcon />{mt("Attachment point")}</PopoverItem>
        <PopoverItem onClick={() => select('polymer')}><PolymerIcon />{mt("Polymer repeat unit")}</PopoverItem>
      </PopoverContent>
    </Popover>
  </div>
}

function ElementPicker({ tool, onTool, finalFocus }: ToolProps & { finalFocus: RefObject<HTMLElement | null> }) {
  const { t: mt } = useLocale()
  const { container } = use(Overlay)
  const compact = use(ToolbarLayout)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const choose = (symbol: string) => {
    onTool(`atom:${symbol}`)
    setRecent(values => [symbol, ...values.filter(value => value !== symbol)].filter(value => !atoms.some(([atom]) => atom === value)).slice(0, 3))
    setOpen(false)
  }
  const needle = query.trim().toLowerCase()
  return <>
    {recent.map(symbol => <Tool key={symbol} id={`atom:${symbol}`} label={elements.find(([value]) => value === symbol)?.[1] ?? symbol} tool={tool} onTool={onTool} className={`me-atom me-el-${symbol}`}>{symbol}</Tool>)}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<ToolButton label={mt("Periodic table")} hideTooltip={open} aria-pressed={open}><ElementsIcon /></ToolButton>} />
      <PopoverContent aria-label={mt("Periodic table")} side={compact ? 'top' : 'left'} align={compact ? 'center' : 'end'} container={container} finalFocus={finalFocus} className="me-popup w-[min(760px,calc(100vw-24px))] gap-2">
        <Input name="element-search" autoComplete="off" spellCheck={false} aria-label={mt("Find an element")} placeholder={mt("Element name, symbol or atomic number…")} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="me-elements-scroll">
          <div className="me-elements" onKeyDown={event => moveFocus(event)}>
            {elements.map(([symbol, name, row, column], index) => <button type="button" key={symbol} aria-label={`${mt(name)}, ${symbol}, ${index + 1}`} aria-pressed={tool === `atom:${symbol}`} title={mt(name)} style={{ gridRow: row, gridColumn: column }} className="me-element" disabled={!!needle && !`${symbol} ${name} ${mt(name)}`.toLowerCase().includes(needle) && String(index + 1) !== needle} onClick={() => choose(symbol)}><span className="me-atomic-number">{index + 1}</span>{symbol}</button>)}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </>
}

export const LeftPanel = memo(function LeftPanel({ tool, onTool, container, finalFocus }: SideProps & { finalFocus: RefObject<HTMLElement | null> }) {
  const { t: mt } = useLocale()
  const props = { tool, onTool }
  return <Panel edge="left" label={mt("Tools")} container={container}>
    <Tool id="hand" label={mt("Pan")} {...props}><HandIcon /></Tool>
    <Tool id="select" label={mt("Select")} {...props}><MousePointer2Icon /></Tool>
    <Tool id="erase" label={mt("Erase")} {...props}><EraserIcon /></Tool>
    <Divider />
    <BondTool finalFocus={finalFocus} {...props} />
    <Tool id="chain" label={mt("Chain")} {...props}><ChainIcon /></Tool>
    <Divider />
    <Tool id="charge:plus" label={mt("Increase charge")} shortcut="+" {...props}><ChargeIcon sign="plus" /></Tool>
    <Tool id="charge:minus" label={mt("Decrease charge")} shortcut="−" {...props}><ChargeIcon sign="minus" /></Tool>
    <Divider />
    <GroupTool finalFocus={finalFocus} {...props} />
  </Panel>
})

export const RightPanel = memo(function RightPanel({ tool, onTool, container, finalFocus }: SideProps & { finalFocus: RefObject<HTMLElement | null> }) {
  const { t: mt } = useLocale()
  return <Panel edge="right" label={mt("Atoms")} container={container}>
    {atoms.map(([symbol, name, key = symbol]) => <Tool key={symbol} id={`atom:${symbol}`} label={name} shortcut={key} tool={tool} onTool={onTool} className={`me-atom me-el-${symbol}`}>{symbol}</Tool>)}
    <Divider />
    <ElementPicker tool={tool} onTool={onTool} finalFocus={finalFocus} />
  </Panel>
})

export const BottomPanel = memo(function BottomPanel({ tool, onTool, container, finalFocus, onTemplate }: SideProps & { finalFocus: RefObject<HTMLElement | null>; onTemplate: (fragment: Fragment) => boolean }) {
  const { t: mt } = useLocale()
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<Fragment[]>([])
  const [selected, setSelected] = useState<number>()
  const select = (fragment: Fragment) => {
    if (!onTemplate(fragment)) return
    setSelected(fragment.id)
    setRecent(values => [fragment, ...values.filter(value => value.id !== fragment.id)].slice(0, 12))
    setOpen(false)
  }
  return <Panel edge="bottom" label={mt("Rings")} container={container}>
    {(Object.keys(rings) as Ring[]).map(ring => <Tool key={ring} id={`ring:${ring}`} label={ring[0].toUpperCase() + ring.slice(1)} tool={tool} onTool={onTool}><RingIcon ring={ring} /></Tool>)}
    <Divider />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<ToolButton label={mt("Fragment library")} className="me-grouped" hideTooltip={open} aria-pressed={tool === 'template'}><LibraryBigIcon /></ToolButton>} />
      <PopoverContent aria-label={mt("Fragment library")} side="top" align="center" container={container} finalFocus={finalFocus} className="me-popup w-[min(720px,calc(100vw-24px))] gap-2">
        {open && <Suspense fallback={<div className="flex h-40 items-center justify-center" role="status" aria-label={mt("Loading fragments")}><Spinner className="size-5 motion-reduce:animate-none" /></div>}><FragmentLibrary selected={selected} recent={recent} onSelect={select} /></Suspense>}
      </PopoverContent>
    </Popover>
  </Panel>
})

export const ZoomPanel = memo(function ZoomPanel({ zoom, onCommand }: { zoom: number; onCommand: (command: CommandId) => void }) {
  const { t: mt } = useLocale()
  return <div className="me-zoom" role="group" aria-label={mt("Canvas zoom")} onPointerDown={event => event.stopPropagation()}>
    <Button variant="ghost" size="icon-sm" aria-label={mt("Zoom out")} onClick={() => onCommand('zoom-out')}><MinusIcon className="size-3.5" /></Button>
    <Button variant="ghost" size="sm" aria-label={`${mt("Zoom:")} ${zoom}%. ${mt("Fit structure")}`} title={mt("Fit structure")} className="min-w-14 px-1 text-xs tabular-nums" onClick={() => onCommand('fit')}>{zoom}%</Button>
    <Button variant="ghost" size="icon-sm" aria-label={mt("Zoom in")} onClick={() => onCommand('zoom-in')}><PlusIcon className="size-3.5" /></Button>
  </div>
})
