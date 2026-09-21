import { snapshotNativeResources } from '../../lib/native-resource-snapshot.mjs';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { runMcpAppOperation } from '../../../../../scripts/mcp-app-session.mjs';
import { captureToolResult } from '../../../../../scripts/mcp-app-capture.mjs';
import { pluginPath } from '../../lib/plugin-root.mjs';

const uri = 'ui://burette/local-viewer.html';
const workspaceUri = 'ui://burette/native-workspace-v1.html';
const locator = { sessionId: z.string().uuid() };
const annotations = { destructiveHint: false, openWorldHint: false };
const layerOperation = z.object({
  type: z.enum(['create', 'update', 'delete']), layerId: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  structureId: z.string().min(1).max(512).optional(), expression: z.record(z.string(), z.unknown()).optional(),
  label: z.string().min(1).max(80).optional(), visible: z.boolean().optional(),
  appearance: z.object({ type: z.enum(['cartoon', 'ball-and-stick', 'spacefill', 'line']),
    opacity: z.number().min(0).max(1).optional(),
    color: z.object({ name: z.enum(['element-symbol', 'chain-id', 'uniform']), value: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }).strict(),
  }).strict().optional(),
}).strict();
const openRequestId = z.string().uuid().optional().describe('A fresh UUID v4 for each intentional workspace. Reuse the same ID and paths/options when retrying a timed-out opener; it reuses the snapshot/session, not a guaranteed single host card.');

async function runOperation(input, privateResult, assetRoot) {
  // Use the CLI-owned implementation in this persistent server, not one new
  // CLI process for every heartbeat and source chunk. The bundle includes it.
  let result;
  try { result = await runMcpAppOperation(input, { assetRoot }); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message || 'Local viewer operation failed.' }] }; }
  if (privateResult) return { content: [], _meta: { payload: result } };
  const capture = captureToolResult(result);
  if (capture) return capture;
  const { token, ...publicResult } = result;
  return { ...(result.status === 'failed' ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(publicResult) }], structuredContent: publicResult, ...(token ? { _meta: { session: { sessionId: result.sessionId, token } } } : {}) };
}

export async function registerLocalViewer(server) {
  const resources = await snapshotNativeResources(pluginPath('assets'));
  const operation = (input, privateResult = false) => runOperation(input, privateResult, resources.assetRoot);
  registerAppResource(server, 'burette-native-workspace', workspaceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: workspaceUri, mimeType: RESOURCE_MIME_TYPE, text: resources.workspace, _meta: { ui: { csp: { connectDomains: ['blob:'], resourceDomains: ['blob:', 'data:'], frameDomains: ['blob:'] }, prefersBorder: false } } }],
  }));
  registerAppResource(server, 'burette-local-viewer', uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: resources.compact, _meta: { ui: { csp: { connectDomains: ['blob:'], resourceDomains: ['blob:', 'data:'], frameDomains: ['blob:'] }, prefersBorder: true } } }],
  }));
  registerAppTool(server, 'burette.open_viewer', {
    title: 'Burette',
    description: 'Create the first native Burette workspace for this task, full chat width with content-adaptive height by default. Open in side pane through its bottom-right button or set_display_mode fullscreen only when requested. If one already exists, use control_inline_viewer with action open_files and paths to add internal tabs instead of opening another pane. Supports structures, collections, sketches, docking and MVSX Stories; up to 8 files/16 MiB total. view auto opens tabs, ketcher seeds the editor, docking combines receptor and additionalFiles as ligands. No localhost or upload. Keep sessionId; observe readiness before controlling. Display changes and host unmount do not terminate the session.',
    inputSchema: { file: z.string().min(1), openRequestId, additionalFiles: z.array(z.string().min(1)).max(7).optional(), view: z.enum(['auto', 'ketcher', 'docking']).optional() }, annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: workspaceUri } },
  }, input => operation({ operation: 'open', ...input, workspace: true, displayMode: 'inline' }));
  registerAppTool(server, 'burette.open_inline_viewer', {
    title: 'Open compact inline Burette viewer',
    description: 'Open a compact inline MCP viewer of one local PDB/mmCIF file. For a native side pane use burette.open_viewer. This App has no localhost server or upload. Wait for observe_inline_viewer.ready before controlling; fullscreen changes placement on the same session.',
    inputSchema: { file: z.string().min(1), openRequestId }, annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: uri } },
  }, input => operation({ operation: 'open', ...input }));
  server.registerTool('burette.observe_inline_viewer', {
    title: 'Observe local Burette viewer', description: 'Get bounded live readiness, activeDocument, tabs, closedTabs, counts, camera, display mode, revision and last action. A created session alone does not prove rendering.',
    inputSchema: locator, annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
  }, input => operation({ operation: 'observe', ...input }));
  server.registerTool('burette.control_inline_viewer', {
    title: 'Control local Burette viewer', description: 'Visual self-check: action {type:"capture_scene",scope:"auto"} returns actual PNG images to you; a selected ligand automatically adds matching 2D. scope ligand requires one selected ligand; scene omits 2D. Capture keeps the camera and selection. Inspect depiction.status for missing 2D. Operate the current molecular scene, not source code. Reuse this task\'s sessionId. Color chains with action {type:"color_by_chain",palette:["#34c759","#af52de"]}; palette is 1–32 hex colors in author-chain order. To show another file, send {type:"open_files",paths:["/absolute/new-file.pdb"]}: existing tabs are focused, not duplicated. Limit: 8 unique files/16 MiB per session. Also supports activate_tab, close_tab, close_other_tabs, move_tab (tabId; zero-based toIndex), close_all_tabs, Mol* scene/style/selection/camera, Ketcher and Story actions. Wait for acknowledgement; queued is not completed. Observe activeDocument before molecular commands; stale targets are rejected. set_display_mode changes placement without reloading. An unmounted pane must be brought back, not replaced by another opener.',
    inputSchema: { ...locator, waitMs: z.number().int().min(0).max(30000).optional(), action: z.object({ type: z.enum(['query_atoms', 'query_groups', 'named_selection', 'select_atoms', 'measure_geometry', 'list_scene_layers', 'patch_scene_layers', 'focus_ligand', 'select_residues', 'focus_selection', 'reset_camera', 'clear_selection', 'set_display_mode', 'set_molstar_style', 'color_by_chain', 'set_scene_motion', 'set_scene_wiggle', 'rotate_camera', 'observe_scene', 'capture_scene', 'activate_tab', 'close_tab', 'close_other_tabs', 'close_all_tabs', 'move_tab', 'open_ketcher', 'control_ketcher', 'open_files', 'open_docking_view', 'story_observe', 'story_control', 'observe_frames', 'control_frames', 'manage_tabs']), selectionVersion: z.literal(1).optional(), operations: z.array(layerOperation).min(1).max(8).optional(), structureId: z.string().max(512).optional(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional(), expression: z.record(z.string(), z.unknown()).optional(), groupBy: z.enum(['residue', 'chain']).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(32).optional(), dryRun: z.boolean().optional(), measurement: z.enum(['distance', 'angle', 'dihedral']).optional(), atomIds: z.array(z.string().max(512)).min(2).max(4).optional() }).passthrough() },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
  }, input => operation({ operation: 'act', ...input, waitMs: input.waitMs ?? (input.action.type === 'capture_scene' ? 30000 : 12000) }));
  registerAppTool(server, 'burette.inline_viewer_exchange', {
    title: 'Exchange local viewer state', description: 'Private mounted-app transport for source chunks, observation and action acknowledgements.',
    inputSchema: { ...locator, token: z.string().uuid(), close: z.boolean().optional(), source: z.boolean().optional(), documentId: z.string().uuid().optional(), offset: z.number().int().nonnegative().optional(), state: z.record(z.string(), z.unknown()).optional(), completed: z.record(z.string(), z.unknown()).optional(),
      fileAction: z.object({ type: z.enum(['list_apps', 'app_icon', 'reveal', 'open_default', 'open_with']), documentId: z.string().uuid(), targetId: z.string().max(24).optional() }).optional(),
      checkpoint: z.object({ key: z.string().max(64), value: z.string().max(699052).optional() }).optional(),
      xyzrender: z.object({ documentId: z.string().uuid().optional(), inputDataBase64: z.string().max(699052).optional(), inputExtension: z.string().max(8).optional(), preset: z.string().max(24).optional(), orientationRef: z.string().max(65536).nullable().optional(), activeModel: z.number().int().nonnegative().nullable().optional(), controls: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 16384).optional() }).optional(),
      asset: z.object({ manifest: z.boolean().optional(), path: z.string().max(256).optional(), offset: z.number().int().nonnegative().optional() }).optional() },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false }, _meta: { ui: { visibility: ['app'] } },
  }, input => operation({ operation: 'exchange', ...input }, true));
}
