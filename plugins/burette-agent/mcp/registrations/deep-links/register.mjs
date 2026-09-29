import { basename, dirname, isAbsolute } from 'node:path';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { runBuretteAgent } from '../../lib/cli-bridge.mjs';
import { pluginRoot } from '../../lib/plugin-root.mjs';
import { resolveWorkspaceSession } from '../../lib/session-registry.mjs';
import { toolText } from '../../lib/tool-response.mjs';

// Installed plugins live in <cache>/<marketplace>/<plugin>/<version>; a source
// checkout has no marketplace and gets no Codex link.
function codexLink(appPath) {
  const pluginDir = dirname(pluginRoot);
  if (basename(dirname(dirname(pluginDir))) !== 'cache') return null;
  const plugin = `${encodeURIComponent(basename(pluginDir))}@${encodeURIComponent(basename(dirname(pluginDir)))}`;
  return `codex://plugins/${plugin}/app/burette.open_app?path=${encodeURIComponent(appPath)}`;
}

function appPath(kind, target = '') {
  if (kind === 'pdb' && /^[0-9][A-Za-z0-9]{3}$/u.test(target.trim())) return `/pdb/${target.trim().toUpperCase()}`;
  if (kind === 'open' && isAbsolute(target)) return `/open?path=${encodeURIComponent(target)}`;
  return null;
}

export function registerDeepLinks(server) {
  registerAppTool(server, 'burette.create_link', {
    title: 'Create Burette Link',
    description: 'Create a navigation link for a PDB ID, absolute local file/project path, or existing desktop workspace. deepLink opens the installed macOS app; for a PDB ID or file, codexLink opens the Burette app in the Codex sidebar. Local files and sessions work only on this Mac. Does not launch the app or execute viewer actions.',
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
    const path = appPath(input.kind, input.target);
    const inCodex = result.ok && path ? codexLink(path) : null;
    return {
      content: toolText(result.ok ? `Open in Burette: ${deepLink}${inCodex ? `\nOpen in Codex: ${inCodex}` : ''}` : 'Could not create Burette link.'),
      ...(result.ok ? {} : { isError: true }),
      structuredContent: { ok: result.ok, deepLink: deepLink || null, codexLink: inCodex, error: result.error || null },
    };
  });
}
