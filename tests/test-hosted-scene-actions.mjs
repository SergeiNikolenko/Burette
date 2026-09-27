import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { sanitizeViewerActions } from '../apps/burette-public-plugin/lib/hosted-context.ts';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function applyHostedMcpActions()');
const end = source.indexOf("  window.addEventListener('burette-agent-ready'", start);
assert.ok(start > 0 && end > start);

for (const nested of [false, true]) {
  const actions = [{ type: 'select_residues', selector: { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 5 } }, { type: 'reset_camera' }];
  const executed = [], reports = [];
  let release;
  const bridgeHost = { BuretteHostedAppBridge: { ready: new Promise(resolve => { release = resolve; }), sanitizeViewerActions: () => [] } };
  const window = {
    ...(nested ? { parent: bridgeHost } : bridgeHost),
    BuretteConfig: { hostedMcpActions: actions, documentId: 'test' },
    BuretteAgent: { ready: Promise.resolve() },
    __mqlPost: (_type, _message, value) => reports.push(value.report),
  };
  const context = { window, hostedMcpActionsApplied: false,
    executeBuretteAgentAction: async action => { executed.push(action); return { ok: true }; },
    hostedMcpSelectionFromResults: () => ({ atoms: 33 }),
    agentActionFailure: (command, code, message) => ({ ok: false, command, error: { code, message } }),
  };
  runInNewContext(source.slice(start, end), context);
  const pending = context.applyHostedMcpActions();
  const host = nested ? bridgeHost : window;
  host.BuretteHostedAppBridge = { ready: Promise.resolve(true), sanitizeViewerActions };
  release(true);
  await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(executed)), sanitizeViewerActions(actions));
  assert.equal(reports[0].results.length, 2);
  await context.applyHostedMcpActions();
  assert.equal(executed.length, 2, 'initial scene actions run only once');
  context.hostedMcpActionsApplied = false;
  window.BuretteConfig.hostedMcpActions = [{ type: 'delete_file', path: '/private' }];
  await context.applyHostedMcpActions();
  assert.equal(executed.length, 2, 'parent bridge does not bypass the action allowlist');
  assert.equal(reports.at(-1).results[0].error.code, 'ACTION_ERROR');
}
console.log('Hosted scene actions work in standalone and nested viewer frames');
