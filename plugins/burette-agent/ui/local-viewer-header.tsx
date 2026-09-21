import { createRoot } from 'react-dom/client';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { ChevronUp, ExpandLarge, CollapseLarge } from '@openai/apps-sdk-ui/components/Icon';
import { Menu } from '@openai/apps-sdk-ui/components/Menu';

const root = createRoot(document.getElementById('mcp-header')!);
export const disposeViewerHeader = () => root.unmount();

export function renderViewerHeader({ expanded, canExpand, onToggle }: {
  expanded: boolean; canExpand: boolean; onToggle: () => void;
}) {
  root.render(
    <nav aria-label="Viewer display">
      <Menu>
        <Menu.Trigger>
          <Button color="secondary" variant="outline" size="sm" disabled={!canExpand} aria-label="Codex workspace menu">
            Codex
            <ChevronUp aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Content align="end" side="top" minWidth={220}>
          <Menu.Item disabled={!canExpand} onSelect={onToggle}>
            {expanded ? <CollapseLarge aria-hidden="true" /> : <ExpandLarge aria-hidden="true" />}
            {expanded ? 'Return to chat' : 'Open in side pane'}
          </Menu.Item>
        </Menu.Content>
      </Menu>
    </nav>,
  );
}
