import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { runMcpAppOperation } from '../../../../../scripts/mcp-app-session.mjs';
import { molecularCapabilities } from '../../../../../scripts/molecular-session-actions.mjs';
import { pdbIdSchema, resolvePdbEntry } from '../../lib/pdb-entry.mjs';

const locator = { sessionId: z.string().uuid() };
const request = { ...locator, requestId: z.string().uuid() };
const selection = z.object({ documentId: z.string().uuid(), chain: z.string().max(16),
  residues: z.array(z.number().int()).max(256).optional() }).strict();
const target = selection;
const layer = z.object({ documentId: z.string().uuid(), chain: z.string().max(16).optional(),
  residues: z.array(z.number().int()).max(256).optional(), componentId: z.string().max(16).optional(),
  representation: z.enum(['cartoon', 'ball-and-stick']), color: z.string().regex(/^#[a-f\d]{6}$/iu).optional() }).strict();
const scene = z.object({ layers: z.array(layer).min(1).max(32).optional(),
  labels: z.array(z.object({ documentId: z.string().uuid(), chain: z.string().max(16), residue: z.number().int(),
    componentId: z.string().max(16).optional(), text: z.string().min(1).max(80) }).strict()).max(32).optional(),
  transforms: z.array(z.object({ documentId: z.string().uuid(), rotation: z.array(z.number()).length(9),
    translation: z.array(z.number()).length(3) }).strict()).max(8).optional(),
  background: z.string().regex(/^#[a-f\d]{6}$/iu).optional(),
  camera: z.object({ direction: z.enum(['front', 'left']).optional(), zoom: z.number().min(0.5).max(2).optional() }).strict().optional(),
}).strict();
const analysis = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect') }).strict(),
  z.object({ type: z.literal('contacts'), selection, target, cutoff: z.number().min(0.1).max(8).optional() }).strict(),
  z.object({ type: z.literal('buried_area'), selection, target, probeRadius: z.number().min(0.1).max(3).optional(), samples: z.number().int().min(24).max(960).optional() }).strict(),
  z.object({ type: z.literal('align'), selection, target }).strict(),
  z.object({ type: z.literal('render'), outputPath: z.string().min(1).max(4096), width: z.number().int().min(64).max(2400).optional(),
    height: z.number().int().min(64).max(2400).optional(), scene: scene.optional() }).strict(),
]);
const annotations = { destructiveHint: false, openWorldHint: false, readOnlyHint: false, idempotentHint: true };

async function result(operation, { presentation = false } = {}) {
  try {
    const value = await operation();
    const { token, presentationId, ...publicValue } = value;
    return { content: [{ type: 'text', text: JSON.stringify(publicValue) }], structuredContent: publicValue,
      ...(presentation ? { _meta: { session: { sessionId: value.sessionId, token, presentationId } } } : {}) };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: String(error.message).slice(0, 1024) }],
      structuredContent: { error: { code: error.code ?? 'MOLECULAR_OPERATION_FAILED', message: String(error.message).slice(0, 1024) } } };
  }
}

export function registerMolecularBackground(server) {
  server.registerTool('burette.open_molecular_session', {
    title: 'Open autonomous molecular session',
    description: 'Snapshot PDB/mmCIF sources for background analysis without a viewer or an open chat. Use this for contacts, SASA, TM-align or PNG export. Retain sessionId and document IDs. No panel is opened. One openRequestId per intentional session; reuse it for retries.',
    inputSchema: { file: z.string().min(1).max(4096).optional(), pdbId: pdbIdSchema.optional(),
      additionalFiles: z.array(z.string().min(1).max(4096)).max(7).optional(), openRequestId: z.string().uuid() },
    annotations: { ...annotations, openWorldHint: true },
  }, input => result(async () => {
    if (Number(Boolean(input.file)) + Number(Boolean(input.pdbId)) !== 1) throw new Error('Provide exactly one file or PDB ID.');
    const file = input.pdbId ? await resolvePdbEntry(input.pdbId) : input.file;
    const { ready, ...session } = await runMcpAppOperation({ operation: 'open', ...input, file, autonomous: true, workspace: true });
    return { ...session, molecular: molecularCapabilities };
  }));
  server.registerTool('burette.add_molecular_files', {
    title: 'Add autonomous molecular sources', description: 'Add local files or explicit public PDB IDs to the same autonomous session without mounting a panel. Use returned document IDs for analysis and scene layers.',
    inputSchema: { ...locator, paths: z.array(z.string().min(1).max(4096)).max(7).optional(),
      pdbIds: z.array(pdbIdSchema).max(7).optional() }, annotations: { ...annotations, openWorldHint: true },
  }, input => result(async () => {
    const count = (input.paths?.length ?? 0) + (input.pdbIds?.length ?? 0);
    if (count < 1 || count > 7) throw new Error('Provide 1–7 local files or public PDB IDs.');
    const ids = [...new Set((input.pdbIds ?? []).map(id => id.trim().toUpperCase()))];
    const paths = [...(input.paths ?? []), ...await Promise.all(ids.map(resolvePdbEntry))];
    return runMcpAppOperation({ operation: 'molecular', command: 'add_files', sessionId: input.sessionId, paths });
  }));
  server.registerTool('burette.run_molecular_operation', {
    title: 'Run background molecular operation',
    description: 'Run inspect, 4 Å-style heavy-atom contacts, Shrake–Rupley buried area, chain TM-align, or versioned Mol* PNG/MVSJ/metadata export independently of the panel. Author chain/residue numbering. Reuse requestId for retries. queued/running is not completion: poll molecular_job. Rendering requires installed Chromium; data analysis does not. Jobs serialize across chats and release processes on completion.',
    inputSchema: { ...request, action: analysis, waitMs: z.number().int().min(0).max(30000).optional() }, annotations,
  }, input => result(() => runMcpAppOperation({ operation: 'molecular', command: 'run', ...input })));
  server.registerTool('burette.molecular_job', {
    title: 'Read or cancel molecular job', description: 'Read durable job status, results, errors and CPU/memory metrics, or explicitly cancel it. A closed/stale panel does not cancel a job. Completed results survive MCP restart.',
    inputSchema: { ...request, cancel: z.boolean().optional() }, annotations,
  }, ({ cancel, ...input }) => result(() => runMcpAppOperation({ operation: 'molecular', command: cancel ? 'cancel' : 'status', ...input })));
  registerAppTool(server, 'burette.show_molecular_session', {
    title: 'Show autonomous molecular session', description: 'Attach a Burette panel to an existing background session. Optionally include requestId of a completed render to add its saved self-contained scene. This does not repeat calculations; UI readiness remains separate from data readiness.',
    inputSchema: { ...locator, requestId: z.string().uuid().optional() }, annotations,
    _meta: { ui: { resourceUri: 'ui://burette/native-workspace-v1.html' } },
  }, input => result(() => runMcpAppOperation({ operation: 'molecular', command: 'present', ...input }), { presentation: true }));
}
