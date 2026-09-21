import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { localFileAction } from './local-file-actions.mjs';
import { renderNativeWorkspaceXyz } from './native-workspace-xyzrender.mjs';
import { readMcpAppAsset } from './mcp-app-assets.mjs';
import { snapshotMcpDocuments, appendMcpDocuments } from './mcp-app-documents.mjs';
import { captureToolResult } from './mcp-app-capture.mjs';
import { mcpAppCheckpoint } from './mcp-app-checkpoint.mjs';
import { completeMcpAction, enqueueMcpAction, pendingMcpActions, readMcpAction, withMcpAdmission } from './mcp-app-action-log.mjs';
import { openMcpSession } from './mcp-app-open.mjs';

const root = join(tmpdir(), 'burette-mcp-app');
const maxStateBytes = 64 * 1024;
const apiVersion = 'burette-mcp-app/v1';
const actions = new Set(['focus_ligand', 'select_residues', 'focus_selection', 'reset_camera', 'clear_selection', 'set_display_mode', 'set_molstar_style', 'color_by_chain', 'set_scene_motion', 'set_scene_wiggle', 'rotate_camera', 'observe_scene', 'capture_scene', 'activate_tab', 'close_tab', 'close_other_tabs', 'close_all_tabs', 'move_tab']);
const workspaceActions = new Set(['query_atoms', 'query_groups', 'named_selection', 'select_atoms', 'measure_geometry', 'list_scene_layers', 'patch_scene_layers', 'open_ketcher', 'control_ketcher', 'open_files', 'open_docking_view', 'story_observe', 'story_control', 'observe_frames', 'control_frames', 'manage_tabs']);
const workspaceShellActions = new Set(['activate_tab', 'close_tab', 'close_other_tabs', 'close_all_tabs', 'move_tab', 'set_display_mode', 'open_ketcher', 'open_files', 'open_docking_view', 'manage_tabs']);

async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

function directory(sessionId) {
  if (!/^[0-9a-f-]{36}$/u.test(sessionId || '')) throw new Error('Invalid MCP App session ID.');
  return join(root, sessionId);
}

async function readSession(sessionId) {
  try { return JSON.parse(await readFile(join(directory(sessionId), 'session.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The CLI owns this transport. MCP only forwards bounded operations to it.
export async function runMcpAppOperation(input, { assetRoot } = {}) {
  if (input.operation === 'open') {
    if (input.view != null && !['auto', 'ketcher', 'docking'].includes(input.view)) throw new Error('Unknown native workspace view.');
    if (input.displayMode != null && !['inline', 'fullscreen'].includes(input.displayMode)) throw new Error('Display mode must be inline or fullscreen.');
    if (input.additionalFiles != null && (!Array.isArray(input.additionalFiles) || input.additionalFiles.length > 7)) throw new Error('A native workspace supports at most 8 files.');
    return openMcpSession(root, input, async (sessionId, sessionDir) => {
      const { snapshots } = await snapshotMcpDocuments([input.file, ...(input.additionalFiles || [])], input.workspace);
      if (input.view === 'docking' && snapshots.length < 2) throw new Error('Docking requires a receptor and at least one ligand file.');
      if (input.view === 'ketcher' && !['mol', 'sdf', 'sd', 'smi', 'smiles', 'ket', 'rxn'].includes(snapshots[0].document.format)) throw new Error('Ketcher requires MOL, SDF, SMILES, KET or RXN input.');
      await mkdir(join(sessionDir, 'actions'), { mode: 0o700 });
      const { label, format, byteCount, sha256 } = snapshots[0].document;
      const session = { apiVersion, sessionId, token: randomUUID(), label, format, byteCount, sha256, documents: snapshots.map(item => item.document), requestedDisplayMode: input.displayMode || 'inline', ...(input.workspace ? { workspace: true, view: input.view || 'auto' } : {}) };
      // Snapshot once; publish the session only after all its sources and state.
      for (const [index, item] of snapshots.entries()) await writeFile(join(sessionDir, index === 0 ? 'source' : `source-${item.document.id}`), item.bytes, { mode: 0o600 });
      await writeJson(join(sessionDir, 'observe.json'), { ready: false, revision: 0, displayMode: 'inline' });
      await writeJson(join(sessionDir, 'session.json'), session);
      return { ...session, ready: false };
    });
  }
  let session = await readSession(input.sessionId);
  // A host may replay an old tool card after the OS has removed its temporary
  // snapshots. Report terminal state without leaking paths or reopening files.
  if (!session) {
    if (input.operation === 'exchange') return { closed: true, expired: true, actions: [] };
    if (input.operation === 'observe') return { apiVersion, sessionId: input.sessionId, ready: false, closed: true, expired: true, tabs: [], activeDocument: null, selection: null };
    throw new Error('Viewer session has expired. Open a new viewer to start a new session.');
  }
  const sessionDir = directory(session.sessionId);
  const closed = await readFile(join(sessionDir, 'closed.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (input.operation === 'observe') {
    if (closed) return { apiVersion, sessionId: session.sessionId, ...closed, ready: false, closed: true, tabs: [], activeDocument: null, selection: null };
    const state = JSON.parse(await readFile(join(sessionDir, 'observe.json'), 'utf8'));
    const age = Date.now() - Date.parse(state.updatedAt);
    const fresh = Number.isFinite(age) && age >= 0 && age < 15000;
    const status = !Number.isFinite(age) ? 'awaiting_mount' : !fresh ? 'stale'
      : state.error ? 'error' : state.ready === true ? 'ready'
        : Array.isArray(state.tabs) && state.tabs.length === 0 ? 'empty' : 'loading';
    return { apiVersion, sessionId: session.sessionId, label: session.label, sha256: session.sha256, ...state,
      ready: state.ready === true && fresh,
      lifecycle: { status, heartbeatAgeMs: Number.isFinite(age) ? Math.max(0, age) : null },
    };
  }
  if (input.operation === 'act') {
    if (closed) throw new Error('Viewer is closed. Open a new viewer to start a new session.');
    const waitMs = input.waitMs ?? 0;
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error('waitMs must be an integer from 0 to 30000.');
    if (!actions.has(input.action?.type) && !(session.workspace && workspaceActions.has(input.action?.type))) throw new Error('Unsupported MCP App action.');
    const actionLimit = input.action.type === 'control_ketcher' ? 72 * 1024 : 8192;
    if (Buffer.byteLength(JSON.stringify(input.action)) > actionLimit) throw new Error('Action exceeds its payload limit.');
    if (session.workspace) {
      const paths = input.action.type === 'open_docking_view' ? [input.action.receptorPath, ...(input.action.ligandPaths || [])]
        : input.action.type === 'manage_tabs' && input.action.operation === 'open_file' ? [input.action.path] : [];
      if (!Array.isArray(paths) || paths.some(path => !session.documents.some(item => item.path === path))) throw new Error('File is not authorized for this workspace.');
    }
    if (input.action.type === 'set_display_mode' && !['inline', 'fullscreen'].includes(input.action.mode)) throw new Error('Display mode must be inline or fullscreen.');
    const state = await runMcpAppOperation({ operation: 'observe', sessionId: session.sessionId });
    if (['activate_tab', 'close_tab', 'close_other_tabs', 'move_tab'].includes(input.action.type)) {
      const tabId = input.action.tabId || state.activeDocument?.id;
      const catalog = input.action.type === 'activate_tab'
        ? session.workspace ? [...(state.tabs || []), ...(state.closedTabs || [])] : session.documents
        : state.tabs;
      if (!catalog?.some(item => item.id === tabId)) throw new Error('Unknown document tab.');
      if (input.action.type === 'move_tab' && (!Number.isInteger(input.action.toIndex) || input.action.toIndex < 0 || input.action.toIndex >= state.tabs.length)) throw new Error('Invalid tab move.');
    }
    const canReopen = input.action.type === 'activate_tab' && Array.isArray(state.closedTabs) && Date.now() - Date.parse(state.updatedAt) < 15000;
    const canUseShell = session.workspace && workspaceShellActions.has(input.action.type) && Array.isArray(state.tabs)
      && !['awaiting_mount', 'stale'].includes(state.lifecycle.status);
    if (!state.ready && !canReopen && !canUseShell) {
      throw new Error(`Viewer is not mounted and ready (${state.lifecycle.status}). Bring back the existing MCP App before controlling it.`);
    }
    const { actionId } = await enqueueMcpAction(sessionDir, async () => {
      if (await stat(join(sessionDir, 'closed.json')).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Viewer is closed.');
      if (session.workspace && input.action.type === 'open_files') {
        if (state.capabilities?.addFiles !== true) throw new Error('Reload the existing Burette pane to enable file additions; do not open a duplicate workspace.');
        const appended = await appendMcpDocuments(sessionDir, input.action.paths);
        session = appended.session;
        input = { ...input, action: { ...input.action, paths: appended.paths } };
      }
      return { actionId: randomUUID(), action: input.action, documentId: state.activeDocument?.id, status: 'queued', queuedAt: process.hrtime.bigint().toString() };
    });
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const action = await readMcpAction(sessionDir, actionId);
      if (!action) throw new Error('Action record is unavailable.');
      if (action.status !== 'queued') return { sessionId: session.sessionId, ...action };
      if (await stat(join(sessionDir, 'closed.json')).then(() => true).catch(() => false)) {
        const closeRequested = ['close_tab', 'close_all_tabs'].includes(input.action.type)
          || (input.action.type === 'manage_tabs' && ['close', 'close_all'].includes(input.action.operation))
          || (input.action.type === 'set_display_mode' && input.action.mode === 'inline');
        return { sessionId: session.sessionId, actionId, status: closeRequested ? 'completed' : 'failed', result: { closed: true }, ...(!closeRequested ? { error: 'Viewer closed before this action was acknowledged.' } : {}) };
      }
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    const final = await readMcpAction(sessionDir, actionId);
    return final?.status !== 'queued' && final ? { sessionId: session.sessionId, ...final } : { sessionId: session.sessionId, actionId, status: 'queued' };
  }
  if (input.operation !== 'exchange' || input.token !== session.token) throw new Error('Invalid MCP App capability.');
  if (closed) return { closed: true, actions: [] };
  if (input.checkpoint) return mcpAppCheckpoint(sessionDir, input.checkpoint);
  if (input.asset) return readMcpAppAsset(input.asset, assetRoot);
  if (input.close === true) {
    await withMcpAdmission(sessionDir, () => writeJson(join(sessionDir, 'closed.json'), { updatedAt: new Date().toISOString(), closedTabs: session.documents || [] }));
    return { closed: true, actions: [] };
  }
  if (input.fileAction) {
    const document = session.documents?.find(item => item.id === input.fileAction.documentId);
    if (!document?.path) throw new Error('Document is not authorized for this workspace.');
    return localFileAction({ ...input.fileAction, path: document.path }, {
      authorize: path => path === document.path,
    });
  }
  if (input.xyzrender) {
    const document = session.documents?.find(item => item.id === input.xyzrender.documentId);
    if (!document && !input.xyzrender.inputDataBase64) throw new Error('Document is not authorized for this workspace.');
    const source = document ? { format: document.format, path: join(sessionDir, document.id === session.documents[0].id ? 'source' : `source-${document.id}`) } : undefined;
    return renderNativeWorkspaceXyz(input.xyzrender, { source });
  }
  if (input.source === true) {
    const sourceDocument = input.documentId ? session.documents?.find(item => item.id === input.documentId) : session.documents?.[0];
    if (input.documentId && !sourceDocument) throw new Error('Document is not authorized for this workspace.');
    const descriptor = sourceDocument || session;
    const offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset >= descriptor.byteCount) throw new Error('Invalid source offset.');
    const end = Math.min(offset + 192 * 1024, descriptor.byteCount);
    const bytes = Buffer.alloc(end - offset);
    const source = await open(join(sessionDir, sourceDocument && sourceDocument.id !== session.documents[0].id ? `source-${sourceDocument.id}` : 'source'), 'r');
    try {
      let read = 0;
      while (read < bytes.length) {
        const { bytesRead } = await source.read(bytes, read, bytes.length - read, offset + read);
        if (!bytesRead) throw new Error('Source snapshot is truncated.');
        read += bytesRead;
      }
    } finally { await source.close(); }
    return { config: { documentId: sourceDocument?.id, label: descriptor.label, format: descriptor.format, byteCount: descriptor.byteCount, binary: descriptor.format === 'mvsx', visualizationOnly: true, autoFocusStructure: true, showPanelControls: true, enablePreviewDocks: true, defaultPreviewDocks: [], defaultLayoutState: { left: 'hidden', right: 'hidden', top: 'hidden', bottom: 'hidden' }, theme: 'auto' }, dataBase64: bytes.toString('base64'), nextOffset: end < descriptor.byteCount ? end : null };
  }
  if (input.state) {
    if (Buffer.byteLength(JSON.stringify(input.state)) > maxStateBytes) throw new Error('Viewer state exceeds 64 KiB.');
    await writeJson(join(sessionDir, 'observe.json'), { ...input.state, updatedAt: new Date().toISOString() });
  }
  if (input.completed) {
    const actionId = input.completed.actionId;
    if (!/^[0-9a-f-]{36}$/u.test(actionId || '')) throw new Error('Invalid action ID.');
    const action = await readMcpAction(sessionDir, actionId);
    if (!action) throw new Error('Unknown action ID.');
    const capture = action.action.type === 'capture_scene';
    if (Buffer.byteLength(JSON.stringify(input.completed)) > (capture ? 3 * 1024 * 1024 : maxStateBytes)) throw new Error(capture ? 'Capture result exceeds 3 MiB.' : 'Action result exceeds 64 KiB.');
    if (capture && !input.completed.error && !captureToolResult({ ...action, result: input.completed.result })) throw new Error('Capture result is missing images.');
    if (action.status === 'queued') await completeMcpAction(sessionDir, { ...action, status: input.completed.error ? 'failed' : 'completed', result: input.completed.result, error: input.completed.error });
  }
  const records = await pendingMcpActions(sessionDir);
  const documents = session.workspace ? (await readSession(session.sessionId)).documents : null;
  return { ...(documents ? { documents } : {}), actions: records.slice(0, 1) };
}
