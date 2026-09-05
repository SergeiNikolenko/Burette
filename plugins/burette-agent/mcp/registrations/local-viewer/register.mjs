import { readFile } from 'node:fs/promises';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { runBuretteAgent } from '../../lib/cli-bridge.mjs';
import { pluginPath } from '../../lib/plugin-root.mjs';

const uri = 'ui://burette/local-viewer.html';
const locator = { sessionId: z.string().uuid() };
const annotations = { destructiveHint: false, openWorldHint: false };

async function operation(input, privateResult = false) {
  const response = await runBuretteAgent(['mcp-app', JSON.stringify(input)]);
  if (!response.ok) return { isError: true, content: [{ type: 'text', text: response.error?.message || 'Local viewer operation failed.' }] };
  const result = response.payload.result;
  if (privateResult) return { content: [], _meta: { payload: result } };
  const { token, ...publicResult } = result;
  return { content: [{ type: 'text', text: JSON.stringify(publicResult) }], structuredContent: publicResult, ...(token ? { _meta: { session: { sessionId: result.sessionId, token } } } : {}) };
}

export function registerLocalViewer(server) {
  registerAppResource(server, 'burette-local-viewer', uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await readFile(pluginPath('assets', 'local-viewer.html'), 'utf8'), _meta: { ui: { csp: { connectDomains: [], resourceDomains: ['blob:'] }, prefersBorder: true } } }],
  }));
  registerAppTool(server, 'burette.open_inline_viewer', {
    title: 'Open local Burette viewer',
    description: 'Open one local PDB/mmCIF file as an inline MCP App. No localhost server or upload. Wait for observe_inline_viewer.ready before controlling. Offer fullscreen to inspect in the host side pane; reuse this session.',
    inputSchema: { file: z.string().min(1) }, annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: uri } },
  }, input => operation({ operation: 'open', ...input }));
  registerAppTool(server, 'burette.observe_inline_viewer', {
    title: 'Observe local Burette viewer', description: 'Get bounded live readiness, counts, camera, display mode, revision and last action. A created session alone does not prove rendering.',
    inputSchema: locator, annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
  }, input => operation({ operation: 'observe', ...input }));
  registerAppTool(server, 'burette.control_inline_viewer', {
    title: 'Control local Burette viewer', description: 'Queue a local scene action. Use set_display_mode with fullscreen or inline to move the same viewer without reloading. Observe lastAction to confirm completion.',
    inputSchema: { ...locator, action: z.object({ type: z.enum(['focus_ligand', 'select_residues', 'reset_camera', 'clear_selection', 'set_display_mode']) }).passthrough() },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
  }, input => operation({ operation: 'act', ...input }));
  registerAppTool(server, 'burette.inline_viewer_exchange', {
    title: 'Exchange local viewer state', description: 'Private mounted-app transport for source chunks, observation and action acknowledgements.',
    inputSchema: { ...locator, token: z.string().uuid(), source: z.boolean().optional(), offset: z.number().int().nonnegative().optional(), state: z.record(z.string(), z.unknown()).optional(), completed: z.record(z.string(), z.unknown()).optional() },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false }, _meta: { ui: { visibility: ['app'] } },
  }, input => operation({ operation: 'exchange', ...input }, true));
}
