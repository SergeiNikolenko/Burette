import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { runBuretteAgent } from '../../lib/cli-bridge.mjs';
import { resolveWorkspaceSession } from '../../lib/session-registry.mjs';
import { toolText } from '../../lib/tool-response.mjs';

export function registerDeepLinks(server) {
  registerAppTool(server, 'burette.create_link', {
    title: 'Create Burette Link',
    description: 'Create a navigation link for a PDB ID, absolute local file/project path, or existing desktop workspace. Links open the installed macOS app; local files and sessions work only on this Mac. Does not launch the app or execute viewer actions.',
    inputSchema: {
      kind: z.enum(['pdb', 'open', 'project', 'session']),
      target: z.string().min(1).max(4096).optional(),
      workspaceSessionId: z.string().max(128).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model'] } },
  }, async (input) => {
    let args;
    if (input.kind === 'session') {
      const resolved = resolveWorkspaceSession({ workspaceSessionId: input.workspaceSessionId });
      if (!input.workspaceSessionId || !resolved.ok || resolved.session.mode !== 'desktop-app' || !resolved.session.sessionDir) {
        return { isError: true, content: toolText('A registered desktop workspaceSessionId is required.'), structuredContent: { ok: false, error: { code: 'DESKTOP_SESSION_REQUIRED' } } };
      }
      args = ['link', '--session-dir', resolved.session.sessionDir];
    } else args = ['link', input.kind, input.target || ''];
    const result = await runBuretteAgent(args);
    const deepLink = result.payload?.result?.deepLink;
    return {
      content: toolText(result.ok ? `Open in Burette: ${deepLink}` : 'Could not create Burette link.'),
      ...(result.ok ? {} : { isError: true }),
      structuredContent: { ok: result.ok, deepLink: deepLink || null, error: result.error || null },
    };
  });
}
