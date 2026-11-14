import { useLocale } from "@/components/locale-provider"
import { memo, useEffect, useRef, useState } from 'react'
import { LibraryBigIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { loadCore } from './preload'
import { moveFocus } from './focus'

export type Fragment = { id: number; name: string; group: number; atom: number; bond: number; molfile: string }
type Library = { groups: string[]; templates: Fragment[] }
let library: Promise<Library> | undefined
const previews = new Map<string, string>()

function loadLibrary() {
  return library ??= fetch(new URL('templates.json', document.baseURI)).then(response => {
    if (!response.ok) throw new Error('Unavailable')
    return response.json() as Promise<Library>
  }).then(data => ({ ...data, templates: data.templates.map((fragment, id) => ({ ...fragment, id })) }))
    .catch(error => { library = undefined; throw error })
}

const FragmentButton = memo(function FragmentButton({ fragment, active, onSelect }: { fragment: Fragment; active: boolean; onSelect: (fragment: Fragment) => void }) {
  const node = useRef<HTMLButtonElement>(null)
  const [svg, setSvg] = useState(() => previews.get(fragment.molfile) ?? '')
  useEffect(() => {
    if (svg || !node.current) return
    let disposed = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      loadCore().then(() => import('./core')).then(({ thumbnail }) => {
        if (disposed) return
        try {
          const image = thumbnail(fragment.molfile, 128, 90)
          previews.set(fragment.molfile, image)
          setSvg(image)
        } catch { /* The fragment remains selectable if its preview is unavailable. */ }
      }).catch(() => {})
    }, { rootMargin: '100px' })
    observer.observe(node.current)
    return () => { disposed = true; observer.disconnect() }
  }, [fragment.molfile, svg])
  return <button ref={node} type="button" aria-label={fragment.name} aria-pressed={active} title={fragment.name} className="me-fragment" onClick={() => onSelect(fragment)}>
    {svg ? <span aria-hidden="true" className="me-fragment-image" dangerouslySetInnerHTML={{ __html: svg }} /> : <span aria-hidden="true" className="me-fragment-image"><LibraryBigIcon className="size-5 text-muted-foreground" /></span>}
  </button>
})

export function FragmentLibrary({ selected, recent, onSelect }: { selected?: number; recent: Fragment[]; onSelect: (fragment: Fragment) => void }) {
  const { t: mt } = useLocale()
  const [data, setData] = useState<Library>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('all')
  useEffect(() => {
    let disposed = false
    loadLibrary().then(value => { if (!disposed) setData(value) }, () => { if (!disposed) setFailed(true) })
    return () => { disposed = true }
  }, [attempt])
  if (failed) return <Button variant="outline" size="sm" onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>{mt("Retry library")}</Button>
  if (!data) return <div className="flex h-40 items-center justify-center" role="status" aria-label={mt("Loading fragments")}><Spinner className="size-5 motion-reduce:animate-none" /></div>
  const source = group === 'recent' ? recent : data.templates
  const needle = query.trim().toLocaleLowerCase()
  const filtered = source.filter(fragment => (group === 'all' || group === 'recent' || fragment.group === Number(group)) && (!needle || `${fragment.name} ${data.groups[fragment.group]} ${mt(data.groups[fragment.group])}`.toLocaleLowerCase().includes(needle)))
  return <>
    <div className="me-library-search flex items-center gap-2">
      <div className="relative min-w-0 flex-1"><SearchIcon aria-hidden="true" className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input name="fragment-search" autoComplete="off" spellCheck={false} aria-label={mt("Search fragments")} placeholder={mt("Search fragments…")} className="pl-8" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <select aria-label={mt("Fragment group")} name="fragment-group" className="h-9 max-w-[42%] rounded-md border bg-background px-2 text-sm text-foreground" value={group} onChange={event => setGroup(event.target.value)}>
        <option value="all">{mt("All fragments (")}{data.templates.length})</option>
        {recent.length > 0 && <option value="recent">{mt("Recent")}</option>}
        {data.groups.map((label, index) => <option key={label} value={index}>{mt(label)}</option>)}
      </select>
    </div>
    <div className="me-fragment-grid" onKeyDown={event => moveFocus(event)}>
      {filtered.map(fragment => <FragmentButton key={fragment.id} fragment={fragment} active={fragment.id === selected} onSelect={onSelect} />)}
      {!filtered.length && <p className="col-span-full py-6 text-center text-sm">{mt("No matching fragments")}</p>}
    </div>
  </>
}
