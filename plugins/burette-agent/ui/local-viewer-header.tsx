import { createRoot } from 'react-dom/client';
import { Button } from '../../../apps/desktop/src/components/ui/button';
import Expand from './icons/Expand';

const root = createRoot(document.getElementById('mcp-header')!);

export function renderViewerHeader({ label, detail, expanded, canExpand, onToggle }: {
  label: string; detail: string; expanded: boolean; canExpand: boolean; onToggle: () => void;
}) {
  root.render(
    <header className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium leading-5">{label}</h1>
        <p className="truncate text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
      <Button variant="ghost" size={expanded ? 'sm' : 'icon'} disabled={!canExpand}
        aria-label={expanded ? 'Return to conversation' : 'Expand viewer'}
        title={expanded ? 'Return to conversation' : 'Expand viewer'} onClick={onToggle}>
        {expanded ? 'Back to chat' : <Expand aria-hidden="true" className="size-5" />}
      </Button>
    </header>,
  );
}
