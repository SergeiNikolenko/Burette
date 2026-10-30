import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fixture } from './measurement-pair-fixture';
const { useGraphDraft } = await import('../apps/desktop/src/components/workbench/use-graph-draft');

test('a singular MMFF refusal preserves the exact AddH draft, metadata and undo history', async () => {
  const source = readFileSync(new URL('../samples/collections/sdf/single.sdf', import.meta.url), 'utf8');
  const view = await fixture('sdf', useGraphDraft, source);
  try {
    expect(await view.apply({ kind: 'add-hydrogens' })).not.toBeNull();
    const history = view.graph.history!, current = history.current;
    expect(await view.apply({ kind: 'optimize', method: 'lbfgs', forceField: 'MMFF94' })).toBeNull();
    expect(view.graph.error).toMatch(/energy is not finite for the current coordinates.*3D conformer/);
    expect(view.graph.history).toBe(history); expect(view.graph.history!.current).toBe(current);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(current.text);
  } finally { await view.close(); }
});
