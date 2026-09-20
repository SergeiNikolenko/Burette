import { useEffect, useId, useState } from 'react';
import type { XyzrenderControls } from '../types';
import { renderPropertyGroups, readRenderProperty, setRenderProperty, type RenderProperty } from '../lib/xyzrender-properties';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Field, FieldLabel, FieldDescription, FieldGroup } from './ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { ChevronDown } from './ui/app-icons';

export function XyzrenderProperties({ controls, onChange }: {
  controls: XyzrenderControls; onChange: (controls: XyzrenderControls) => void;
}) {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{ label: string; atoms: string }[]>([]);
  useEffect(() => {
    const receive = (event: Event) => setSelection((event as CustomEvent).detail);
    window.addEventListener('burette:xyzrender-selection', receive);
    return () => window.removeEventListener('burette:xyzrender-selection', receive);
  }, []);
  return <div className="flex flex-col gap-2">
    {selection.length > 0 && <p className="text-xs text-muted-foreground">{selection.length === 1 ? `Selected atoms: ${selection[0].atoms}` : `${selection.length} structures with selected atoms`}</p>}
    <Input aria-label="Find render settings" placeholder="Find settings…" value={query} onChange={event => setQuery(event.target.value)} />
    {renderPropertyGroups.map(group => {
      const fields = group.fields.filter(field => `${group.name} ${field.label} ${field.hint || ''}`.toLowerCase().includes(query.toLowerCase()));
      if (!fields.length) return null;
      return <PropertySection key={`${group.name}-${Boolean(query)}`} name={group.name} description={group.description} expanded={Boolean(query)}>
        <FieldGroup>{fields.map(field => <PropertyField key={field.id} field={field} value={readRenderProperty(controls, field)}
          selection={selection.length === 1 ? selection[0].atoms : undefined} onChange={value => onChange(setRenderProperty(controls, field, value))} />)}</FieldGroup>
      </PropertySection>;
    })}
    <PropertySection name="Advanced arguments" description="Additional xyzrender options">
      <PropertyField field={{ id: 'extraArguments', label: 'Arguments', repeat: true }} value={controls.extraArguments || ''}
        onChange={value => onChange({ ...controls, extraArguments: value })} />
    </PropertySection>
  </div>;
}

function PropertySection({ name, description, expanded = false, children }: {
  name: string; description: string; expanded?: boolean; children: React.ReactNode;
}) {
  return <Collapsible defaultOpen={expanded} className="border-b border-border py-1">
    <CollapsibleTrigger asChild><Button variant="ghost" className="w-full justify-between" aria-label={name}>
      {name}<ChevronDown data-icon="inline-end" />
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="px-2 pb-4 pt-2">
      <p className="mb-4 text-xs text-muted-foreground">{description}</p>{children}
    </CollapsibleContent>
  </Collapsible>;
}

function PropertyField({ field, value, onChange, selection }: { field: RenderProperty; value: string; onChange: (value: string) => void; selection?: string }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (field.kind === 'number' && draft !== '' && (!Number.isFinite(Number(draft)) || (field.min !== undefined && Number(draft) < field.min) || (field.max !== undefined && Number(draft) > field.max))) { setDraft(value); return; }
    if (draft !== value) onChange(draft);
  };
  return <Field orientation={field.kind === 'toggle' && !field.negative ? 'horizontal' : 'vertical'}>
    <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
    {field.negative ? <Select value={value || '__default'} onValueChange={next => onChange(next === '__default' ? '' : next)}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="__default">Default</SelectItem><SelectItem value="true">On</SelectItem><SelectItem value="false">Off</SelectItem></SelectGroup></SelectContent></Select> : field.kind === 'toggle' ? <Switch id={id} checked={value === 'true'} onCheckedChange={checked => onChange(String(checked))} />
      : field.options ? <Select value={value || '__default'} onValueChange={next => onChange(next === '__default' ? '' : next)}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
          <SelectItem value="__default">Default</SelectItem>{field.options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      : field.repeat ? <Textarea id={id} value={draft} rows={3} onChange={event => setDraft(event.target.value)} onBlur={commit} />
      : <Input id={id} type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.step} value={draft}
        placeholder="Default" onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }} />}
    {selection && (field.hint?.startsWith('Atoms:') || ['--hl', '--radius-scale', '--atom-opacity'].includes(field.flag || '')) && <Button variant="ghost" size="sm" onClick={() => {
      const value = field.flag === '--hl' ? `${selection} steelblue` : field.flag === '--radius-scale' ? `${selection} 1.3` : field.flag === '--atom-opacity' ? `${selection} 0.5` : selection;
      setDraft(value); onChange(value);
    }}>Use selected atoms</Button>}
    {field.hint && <FieldDescription>{field.hint}</FieldDescription>}
  </Field>;
}
