import { expect, test } from 'bun:test';
import { createLocalViewerContext } from '../plugins/burette-agent/ui/local-viewer-context';

test('context preserves upstream scene truncation and fractional wiggle amplitude', () => {
  const context = createLocalViewerContext({ sessionId: 'test', scene: {
    truncated: true, layers: Array.from({ length: 24 }, () => ({ representation: 'cartoon' })),
    wiggle: { name: 'uncertainty', animation: { wiggleAmplitude: 0.01, wiggleSpeed: 7 } },
  } });
  expect(context.structuredContent.burette.truncated).toBe(true);
  expect(context.structuredContent.burette.scene.wiggle).toEqual({ mode: 'uncertainty', amplitude: 0.01, speed: 7 });
});

test('one text card carries structure, chain, ligand, selection and scene context', () => {
  const context = createLocalViewerContext({
    sessionId: 'test', selection: { cleared: true },
    summary: { label: 'protein.pdb', format: 'pdb', counts: { atoms: 100, residues: 12, chains: 2, structures: 1, models: 1, ligands: 1 }, structures: [{
      label: 'Protein', atomCount: 100, residueCount: 12, models: 1,
      chains: [{ auth_asym_id: 'A', label_asym_id: 'A', entityType: 'polymer', residueCount: 11, atomCount: 90, authSeqRange: [194, 204] }],
      ligands: [{ auth_comp_id: 'NAD', auth_asym_id: 'A', auth_seq_id: 401, atomCount: 10 }],
    }] },
    scene: { displayMode: 'fullscreen', layers: [{ representation: 'cartoon', color: 'chain-id', visible: true }], motion: 'off' },
  });
  expect(context.content).toHaveLength(1);
  expect(context.content[0].type).toBe('text');
  expect(context.content[0].text).toContain('194–204');
  expect(context.content[0].text).toContain('NAD A 401');
  expect(context.content[0].text).toContain('cartoon');
  expect(context.structuredContent.burette.activeSelection).toBeNull();
  expect(context.presentation).toEqual({ composerAttachmentLayout: 'card', composerLabel: 'Burette · protein.pdb' });
});

test('context is bounded and excludes arbitrary payloads and source contents', () => {
  const large = '🧬'.repeat(10000);
  const context = createLocalViewerContext({ sessionId: 'test', selection: {
    atoms: 96, atomIdentities: Array.from({ length: 96 }, () => ({ chain: large, compId: large, atomName: large })),
  }, summary: {
    label: large, structures: Array.from({ length: 100 }, () => ({
      label: large, sourceText: 'PRIVATE_SOURCE', chains: Array.from({ length: 100 }, () => ({ auth_asym_id: large })),
      ligands: Array.from({ length: 100 }, () => ({ auth_comp_id: large })),
    })),
  }, scene: { secret: 'SECRET_TOKEN', layers: Array.from({ length: 100 }, () => ({ label: large, representation: large, color: large })) } });
  const json = JSON.stringify(context);
  expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(48 * 1024);
  expect(new TextEncoder().encode(context.content[0].text).length).toBeLessThanOrEqual(8 * 1024);
  expect(json).not.toContain('PRIVATE_SOURCE');
  expect(json).not.toContain('SECRET_TOKEN');
  expect(context.structuredContent.burette.truncated).toBe(true);
});
