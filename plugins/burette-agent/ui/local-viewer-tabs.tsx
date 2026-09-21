import { createRoot } from 'react-dom/client';
import { DocumentTab } from '../../../apps/desktop/src/components/editor-area/document-tab';
import { ScrollFade } from '../../../apps/desktop/src/components/scroll-fade';
import { Button } from '../../../apps/desktop/src/components/ui/button';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator,
} from '../../../apps/desktop/src/components/ui/context-menu';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
} from '../../../apps/desktop/src/components/ui/dropdown-menu';

type Document = { id: string; label: string; path?: string; format: string; byteCount: number };
type Action = { type: string; tabId?: string; toIndex?: number };
const root = createRoot(document.getElementById('mcp-tabs')!);
export const disposeViewerTabs = () => root.unmount();

export function renderViewerTabs({ tabs, closed, activeId, busy, act }: {
  tabs: Document[]; closed: Document[]; activeId: string | null; busy: boolean;
  act: (action: Action) => void;
}) {
  root.render(<nav className="tab-strip" aria-label="Burette documents">
    <ScrollFade axis="horizontal" className="tab-scroll-region" role="tablist" aria-label="Open structures">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const select = (nextIndex: number) => {
          const next = tabs[(nextIndex + tabs.length) % tabs.length];
          act({ type: 'activate_tab', tabId: next.id });
          document.querySelector<HTMLButtonElement>(`[data-document-tab="${next.id}"] [role="tab"]`)?.focus();
        };
        return <ContextMenu key={tab.id}>
          <ContextMenuTrigger asChild>
            <div className="tab-shell" data-active={active || undefined} data-document-tab={tab.id}
              onDragOver={event => { if (!busy && event.dataTransfer.types.includes('application/x-burette-native-tab')) event.preventDefault(); }}
              onDrop={event => {
                event.preventDefault();
                const id = event.dataTransfer.getData('application/x-burette-native-tab');
                if (tabs.some(item => item.id === id)) act({ type: 'move_tab', tabId: id, toIndex: index });
              }}>
              <DocumentTab label={tab.label} title={tab.path || tab.label} active={active} disabled={busy}
                draggable={!busy} onDragStart={event => event.dataTransfer.setData('application/x-burette-native-tab', tab.id)}
                onClick={() => select(index)} onClose={busy ? undefined : () => act({ type: 'close_tab', tabId: tab.id })}
                onKeyDown={event => {
                  const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
                    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                  if (next !== null) { event.preventDefault(); select(next); }
                }} />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuGroup>
              <ContextMenuItem disabled={busy} onSelect={() => act({ type: 'activate_tab', tabId: tab.id })}>Show Structure</ContextMenuItem>
              <ContextMenuItem disabled={busy} onSelect={() => act({ type: 'inspect_tab', tabId: tab.id })}>Get Info</ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem disabled={busy} onSelect={() => act({ type: 'close_tab', tabId: tab.id })}>Close Tab</ContextMenuItem>
              <ContextMenuItem disabled={busy || tabs.length < 2} onSelect={() => act({ type: 'close_other_tabs', tabId: tab.id })}>Close Other Tabs</ContextMenuItem>
              <ContextMenuItem disabled={busy} onSelect={() => act({ type: 'close_all_tabs' })}>Close All Tabs</ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>;
      })}
    </ScrollFade>
    {closed.length > 0 ? <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" disabled={busy} aria-label="Reopen closed tab">+</Button></DropdownMenuTrigger>
      <DropdownMenuContent><DropdownMenuGroup>{closed.map(tab => <DropdownMenuItem key={tab.id}
        onSelect={() => act({ type: 'activate_tab', tabId: tab.id })}>{tab.label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu> : null}
  </nav>);
}
