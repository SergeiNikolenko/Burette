import { extname, isAbsolute } from 'node:path';
import { snapshotNativeResources } from '../../lib/native-resource-snapshot.mjs';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { recentMcpDocuments, runMcpAppOperation } from '../../../../../scripts/mcp-app-session.mjs';
import { captureToolResult } from '../../../../../scripts/mcp-app-capture.mjs';
import { pluginPath } from '../../lib/plugin-root.mjs';
import { pdbIdSchema, resolvePdbEntry } from '../../lib/pdb-entry.mjs';

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
// Molecular formats the native workspace opens; generic tables stay with the
// host's own viewer.
const fileViewerExtensions = ['.pdb', '.ent', '.pdbqt', '.cif', '.mmcif', '.sdf', '.sd', '.mol', '.smi', '.smiles', '.xyz', '.ket', '.rxn', '.mvsj', '.mvsx'];
const examples = { '1htb': '1htb.pdb', caffeine: 'caffeine.xyz' };

// App-relative deep links into the Burette sidebar app, e.g.
// codex://plugins/burette@<marketplace>/app/burette.open_app?path=%2Fpdb%2F1HTB.
// Returns the files to add to the open workspace, or null for the home page.
async function deepLinkFiles(url) {
  // Only app paths: no authority (//host), fragment or backslash tricks.
  if (!/^\/(?!\/)[^#\\]*$/u.test(url)) throw new Error('Burette cannot open the link: it is not an app path.');
  const link = new URL(url, 'burette-app:/');
  const [kind, value, ...rest] = link.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!kind) return null;
  if (kind === 'pdb' && value && !rest.length && pdbIdSchema.safeParse(value).success) return { paths: [await resolvePdbEntry(value)] };
  if (kind === 'example' && Object.hasOwn(examples, value) && !rest.length) {
    return { paths: [pluginPath('assets', 'examples', examples[value])], view: value === 'caffeine' ? 'xyzrender' : 'auto' };
  }
  const path = link.searchParams.get('path');
  if (kind === 'open' && !value && path && isAbsolute(path) && fileViewerExtensions.includes(extname(path).toLowerCase())) return { paths: [path] };
  throw new Error(`Burette cannot open the link ${link.pathname}${link.search}.`);
}
const openRequestId = z.string().uuid().optional().describe('A fresh UUID v4 for each intentional workspace. Reuse the same ID and paths/options when retrying a timed-out opener; it reuses the snapshot/session and the newest card takes it over.');

async function runOperation(input, privateResult, assetRoot) {
  // Use the CLI-owned implementation in this persistent server, not one new
  // CLI process for every heartbeat and source chunk. The bundle includes it.
  let result;
  try { result = await runMcpAppOperation(input, { assetRoot }); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message || 'Local viewer operation failed.' }] }; }
  if (privateResult) return { content: [], _meta: { payload: result } };
  const capture = captureToolResult(result);
  if (capture) return capture;
  const { token, presentationId, ...publicResult } = result;
  // The JSON text only mirrors structuredContent for older clients.
  return { ...(result.status === 'failed' ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(publicResult), annotations: { audience: ['assistant'] } }], structuredContent: publicResult, ...(token ? { _meta: { session: { sessionId: result.sessionId, token, ...(presentationId ? { presentationId } : {}) } } } : {}) };
}

export async function registerLocalViewer(server) {
  const resources = await snapshotNativeResources(pluginPath('assets'));
  const operation = (input, privateResult = false) => runOperation(input, privateResult, resources.assetRoot);
  registerAppResource(server, 'burette-native-workspace', workspaceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: workspaceUri, mimeType: RESOURCE_MIME_TYPE, text: resources.workspace, _meta: { ui: { csp: { connectDomains: ['blob:'], resourceDomains: ['blob:', 'data:'], frameDomains: ['blob:'] }, prefersBorder: false }, 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] } } }],
  }));
  registerAppResource(server, 'burette-local-viewer', uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: resources.compact, _meta: { ui: { csp: { connectDomains: ['blob:'], resourceDomains: ['blob:', 'data:'], frameDomains: ['blob:'] }, prefersBorder: true } } }],
  }));
  registerAppTool(server, 'burette.open_viewer', {
    title: 'Burette',
    description: 'Create a native Burette workspace card in the chat or native side pane. To just show a structure, prefer burette.open_workspace in the Codex in-app Browser pane; use this card when the user asks for a card, widget or Ketcher drawing, or the Browser is unavailable. Ketcher opens inline in chat by default; other views use the side pane. For drawing, use view ketcher and structure with the actual molecule, never a placeholder file. Bundled example 1htb or caffeine works without a project folder. Otherwise provide file or pdbId. Reuse an existing session with control_inline_viewer. Supports structures, collections, sketches, docking and MVSX; up to 8 files/16 MiB. view xyzrender opens small molecules as xyzrender SVG; proteins above 1500 atoms, SDF collections, sources over 512 KiB or failed renders stay in Mol*: read notes and activeDocument.externalRenderer. Keep sessionId. Creation is not rendering: observe readiness before claiming a molecule is shown. awaiting_mount is host mounting (Codex mounts cards only while the chat is visible), not a missing folder or failure; after one short re-check, finish and say the card appears when the chat is opened. Never switch to the desktop app to repair it.',
    inputSchema: { file: z.string().min(1).optional(), pdbId: pdbIdSchema.optional(),
      example: z.enum(['1htb', 'caffeine']).optional().describe('Bundled protein or 3D xyzrender example; mutually exclusive with file and structure.'),
      structure: z.object({ format: z.enum(['smi', 'mol', 'sdf', 'ket']), content: z.string().min(1).max(65536) }).strict().optional().describe('For Ketcher, pass the requested molecule directly instead of a file. Aspirin: {format:"smi",content:"CC(=O)Oc1ccccc1C(=O)O"}. Requires view ketcher. No project folder or placeholder file needed.'),
      displayMode: z.enum(['inline', 'fullscreen']).optional().describe('Ketcher defaults to inline chat; other views default to side pane. Only expand on request.'),
      openRequestId, additionalFiles: z.array(z.string().min(1)).max(7).optional(), view: z.enum(['auto', 'ketcher', 'docking', 'xyzrender']).optional() }, annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: workspaceUri } },
  }, async ({ pdbId, ...input }) => {
    if ([input.file, input.structure, input.example, pdbId].filter(value => value != null).length !== 1) {
      return { isError: true, content: [{ type: 'text', text: 'Provide exactly one of file, pdbId, structure, or example.' }] };
    }
    let file = input.example ? pluginPath('assets', 'examples', examples[input.example]) : input.file;
    try { if (pdbId) file = await resolvePdbEntry(pdbId); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    return operation({ operation: 'open', ...input, file, view: input.view ?? (input.example === 'caffeine' ? 'xyzrender' : 'auto'), workspace: true, displayMode: input.displayMode ?? (input.view === 'ketcher' ? 'inline' : 'fullscreen') });
  });
  // OpenAI MCP Extensions file entrypoint: Codex offers Burette as the viewer
  // for these files. The argument only carries an opaque host URI. The host adds
  // the opened file's trusted absolute path to calls the mounted app makes, so
  // an opening call without it asks the app to repeat the call itself.
  registerAppTool(server, 'burette.open_file', {
    title: 'Burette',
    description: 'Codex file viewer entrypoint for molecular files. Models should call burette.open_workspace or burette.open_viewer instead.',
    inputSchema: { file: z.object({ name: z.string().min(1), resourceUri: z.string().min(1) }) },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: workspaceUri, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'file', extensions: fileViewerExtensions }] } },
  }, (input, extra) => {
    const path = extra?._meta?.['openai/resource']?.path;
    if (typeof path !== 'string' || !isAbsolute(path)) {
      return { content: [{ type: 'text', text: `Opening ${input.file.name} in Burette.` }], structuredContent: { fileInput: input.file } };
    }
    return operation({ operation: 'open', file: path, view: 'auto', workspace: true, displayMode: 'fullscreen', entrypoint: 'file' });
  });
  // Thread and global entrypoints: the user opens an empty workspace as a tab
  // beside the chat or as the Burette app in the sidebar. Hosts call them with
  // `{}` and show the tool title; a thread tab title should not repeat the
  // plugin name, while the sidebar app keeps it.
  for (const [name, type, title] of [['burette.open_tab', 'thread', 'Molecule Workspace'], ['burette.open_app', 'global', 'Burette']]) {
    registerAppTool(server, name, {
      title,
      description: 'Codex entrypoint that opens an empty Burette workspace. Models should call burette.open_workspace or burette.open_viewer instead.',
      inputSchema: {},
      annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: workspaceUri, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type }] } },
    }, () => operation({ operation: 'open', empty: true, workspace: true, view: 'auto', entrypoint: type }));
  }
  registerAppTool(server, 'burette.open_deep_link', {
    title: 'Open Burette link', description: 'Private sidebar-app transport: opens the files a Codex deep link names in the mounted workspace.',
    inputSchema: { ...locator, url: z.string().startsWith('/').max(4096) },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false, openWorldHint: true }, _meta: { ui: { visibility: ['app'] } },
  }, async ({ sessionId, url }) => {
    let files;
    try { files = await deepLinkFiles(url); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    if (!files) return { content: [], structuredContent: { opened: [] } };
    return operation({ operation: 'act', sessionId, action: { type: 'open_files', paths: files.paths, view: files.view || 'auto' }, waitMs: 0 });
  });
  server.registerTool('burette.recent_files', {
    title: 'Recent Burette files', description: 'Private start-page transport: the newest local files earlier Burette viewers opened.',
    inputSchema: {}, annotations: { ...annotations, readOnlyHint: true, idempotentHint: true }, _meta: { ui: { visibility: ['app'] } },
  }, async () => ({ content: [], structuredContent: { files: await recentMcpDocuments() } }));
  registerAppTool(server, 'burette.open_inline_viewer', {
    title: 'Open compact inline Burette viewer',
    description: 'Open a compact inline MCP viewer of one local PDB/mmCIF file. It is single-document: no open_files, tabs, Ketcher, Story, docking, panels or xyzrender. For those, or a native side pane, use burette.open_viewer. This App has no localhost server or upload. Wait for observe_inline_viewer.ready before controlling; fullscreen changes placement on the same session.',
    inputSchema: { file: z.string().min(1), openRequestId }, annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: uri } },
  }, input => operation({ operation: 'open', ...input }));
  server.registerTool('burette.observe_inline_viewer', {
    title: 'Observe local Burette viewer', description: 'Get bounded live readiness, activeDocument, tabs, closedTabs, counts, camera, display mode, revision and last action. A created session alone does not prove rendering.',
    inputSchema: locator, annotations: { ...annotations, readOnlyHint: true, idempotentHint: true },
  }, input => operation({ operation: 'observe', ...input }));
  server.registerTool('burette.control_inline_viewer', {
    title: 'Control local Burette viewer', description: 'Visual self-check: action {type:"capture_scene",scope:"auto"} returns actual PNG images to you; a selected ligand automatically adds matching 2D. scope ligand requires one selected ligand; scene omits 2D. Capture keeps the camera and selection. Inspect depiction.status for missing 2D. For an xyzrender document, capture_scene returns the rendered SVG as PNG and observe_scene reports externalRenderer. Operate the current molecular scene, not source code. Reuse this task\'s sessionId. Color chains with action {type:"color_by_chain",palette:["#34c759","#af52de"]}; palette is 1–32 hex colors in author-chain order. Native workspace only (burette.open_viewer sessions; the compact inline viewer is single-document): to show another file, send {type:"open_files",paths:["/absolute/new-file.pdb"],view:"auto"|"xyzrender"}; view defaults to the session view, existing tabs are focused, not duplicated. Limit: 8 unique files/16 MiB per session. xyzrender: {type:"set_xyzrender_view",preset?:"default|flat|paton|pmol|skeletal|bubble|tube|btube|mtube|wire|graph|vdw",controls?:{atomScale,bondWidth,canvasSize,displayHydrogens:"all|auto|none",bondNotation:"aromatic|kekule",fog,gradients,transparentBackground,showVdw,hideBonds,molColor,...},renderer?:"xyzrender"|"molstar"}; controls merge with the current ones, null restores a preset default; it completes after the new SVG renders. Also supports activate_tab, close_tab, close_other_tabs, move_tab (tabId; zero-based toIndex), close_all_tabs, set_workspace_panel, Mol* scene/style/selection/camera, Ketcher and Story actions. Tab and file actions complete after observation shows the new state. Wait for acknowledgement; queued is not completed. Observe activeDocument before molecular commands; stale targets are rejected. set_display_mode changes placement without reloading. An unmounted pane must be brought back, not replaced by another opener.',
    inputSchema: { ...locator, waitMs: z.number().int().min(0).max(30000).optional(), action: z.object({ type: z.enum(['query_atoms', 'query_groups', 'named_selection', 'select_atoms', 'measure_geometry', 'list_scene_layers', 'patch_scene_layers', 'focus_ligand', 'select_residues', 'focus_selection', 'reset_camera', 'clear_selection', 'set_display_mode', 'set_molstar_style', 'color_by_chain', 'set_scene_motion', 'set_scene_wiggle', 'rotate_camera', 'observe_scene', 'capture_scene', 'activate_tab', 'close_tab', 'close_other_tabs', 'close_all_tabs', 'move_tab', 'open_ketcher', 'control_ketcher', 'open_files', 'open_docking_view', 'story_observe', 'story_control', 'manage_tabs', 'set_workspace_panel', 'set_xyzrender_view']), selectionVersion: z.literal(1).optional(), operations: z.array(layerOperation).min(1).max(8).optional(), structureId: z.string().max(512).optional(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional(), expression: z.record(z.string(), z.unknown()).optional(), groupBy: z.enum(['residue', 'chain']).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(32).optional(), dryRun: z.boolean().optional(), measurement: z.enum(['distance', 'angle', 'dihedral']).optional(), atomIds: z.array(z.string().max(512)).min(2).max(4).optional(),
      view: z.string().max(16).optional().describe('open_files only: auto or xyzrender renderer request for the added files; defaults to the session view.'),
      preset: z.string().max(24).optional().describe('set_xyzrender_view only: built-in xyzrender preset.'),
      renderer: z.string().max(16).optional().describe('set_xyzrender_view only: xyzrender or molstar; switches the active document renderer.'),
      controls: z.record(z.string(), z.unknown()).optional().describe('set_xyzrender_view only: bounded xyzrender controls; null restores a preset default.') }).passthrough() },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false },
  }, input => operation({ operation: 'act', ...input, waitMs: input.waitMs ?? (['capture_scene', 'set_xyzrender_view'].includes(input.action.type) ? 30000 : 12000) }));
  registerAppTool(server, 'burette.inline_viewer_exchange', {
    title: 'Exchange local viewer state', description: 'Private mounted-app transport for source chunks, observation and action acknowledgements.',
    inputSchema: { ...locator, token: z.string().uuid(), presentationId: z.string().uuid().optional(), close: z.boolean().optional(), source: z.boolean().optional(), documentId: z.string().uuid().optional(), offset: z.number().int().nonnegative().optional(), state: z.record(z.string(), z.unknown()).optional(), completed: z.record(z.string(), z.unknown()).optional(),
      fileAction: z.object({ type: z.enum(['list_apps', 'app_icon', 'reveal', 'open_default', 'open_with']), documentId: z.string().uuid(), targetId: z.string().max(24).optional() }).optional(),
      checkpoint: z.object({ key: z.string().max(64), value: z.string().max(699052).optional() }).optional(),
      xyzrender: z.object({ documentId: z.string().uuid().optional(), inputDataBase64: z.string().max(699052).optional(), inputExtension: z.string().max(8).optional(), preset: z.string().max(24).optional(), orientationRef: z.string().max(65536).nullable().optional(),
        orientation: z.array(z.number().min(-360).max(360)).length(3).optional(),
        animation: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 4096).optional(),
        exportFormat: z.enum(['svg', 'png', 'pdf', 'tiff']).optional(),
        activeModel: z.number().int().nonnegative().nullable().optional(), controls: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 16384).optional() }).optional(),
      asset: z.object({ manifest: z.boolean().optional(), path: z.string().max(256).optional(), offset: z.number().int().nonnegative().optional() }).optional() },
    annotations: { ...annotations, readOnlyHint: false, idempotentHint: false }, _meta: { ui: { visibility: ['app'] } },
  }, input => operation({ operation: 'exchange', ...input }, true));
}
