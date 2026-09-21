import { createSelectionContext } from '../../../apps/burette-public-plugin/lib/hosted-context';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 128) : '';
const scalar = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const count = (value: unknown) => Math.max(0, Math.trunc(scalar(value)));
const list = (value: unknown) => Array.isArray(value) ? value : [];
const range = (value: unknown) => list(value).slice(0, 2).map(n => typeof n === 'number' && Number.isFinite(n) ? n : null);

export function createLocalViewerContext(input: { sessionId: string; selection?: unknown; summary?: unknown; scene?: unknown }) {
  const summary = record(input.summary);
  const source = { kind: 'attachment', fileName: text(summary.label) };
  const selection = createSelectionContext(input.selection, input.sessionId, source);
  const counts = Object.fromEntries(['structures', 'models', 'chains', 'atoms', 'residues', 'ligands'].map(key => [key, count(record(summary.counts)[key])]));
  let truncated = list(summary.structures).length > 8;
  const structures = list(summary.structures).slice(0, 8).map(value => {
    const structure = record(value);
    truncated ||= list(structure.chains).length > 24 || list(structure.ligands).length > 24;
    return {
      label: text(structure.label), atoms: count(structure.atomCount), residues: count(structure.residueCount), models: count(structure.models),
      chains: list(structure.chains).slice(0, 24).map(value => {
        const chain = record(value);
        return { authId: text(chain.auth_asym_id), labelId: text(chain.label_asym_id), entityType: text(chain.entityType), atoms: count(chain.atomCount), residues: count(chain.residueCount), authSeqRange: range(chain.authSeqRange) };
      }),
      ligands: list(structure.ligands).slice(0, 24).map(value => {
        const ligand = record(value);
        return { name: text(ligand.auth_comp_id || ligand.label_comp_id), chain: text(ligand.auth_asym_id), sequence: typeof ligand.auth_seq_id === 'number' ? ligand.auth_seq_id : null, insertionCode: text(ligand.pdbx_PDB_ins_code), atoms: count(ligand.atomCount) };
      }),
    };
  });
  const rawScene = record(input.scene);
  const camera = record(rawScene.camera);
  const vector = (value: unknown) => list(value).slice(0, 3).map(n => typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);
  const scene = {
    displayMode: text(rawScene.displayMode), motion: text(rawScene.motion),
    wiggle: { mode: text(record(rawScene.wiggle).name), amplitude: scalar(record(record(rawScene.wiggle).animation).wiggleAmplitude), speed: scalar(record(record(rawScene.wiggle).animation).wiggleSpeed) },
    camera: { position: vector(camera.position), target: vector(camera.target), up: vector(camera.up) },
    layers: list(rawScene.layers).slice(0, 24).map(value => {
      const layer = record(value);
      return { label: text(layer.label), representation: text(layer.representation), color: text(layer.color), visible: layer.visible === true };
    }),
  };
  truncated ||= rawScene.truncated === true || list(rawScene.layers).length > 24;
  const details = [
    selection.content[0].text,
    `Structure: ${counts.atoms} atoms; ${counts.residues} total residues; ${counts.chains} chains (including non-polymer chains); ${counts.models} models; ${counts.structures} structure objects. Format: ${text(summary.format) || 'unknown'}.`,
    ...structures.slice(0, 4).flatMap(structure => [
      `Object: ${structure.label}. Chains: ${structure.chains.slice(0, 8).map(chain => `${chain.authId} (label ${chain.labelId}, ${chain.entityType}, ${chain.residues} residues${chain.authSeqRange.length ? `, author range ${chain.authSeqRange.join('–')}` : ''})`).join('; ') || 'none'}.`,
      `Ligands (excluding ions/water): ${structure.ligands.slice(0, 12).map(ligand => `${ligand.name} ${ligand.chain} ${ligand.sequence ?? ''}${ligand.insertionCode} (${ligand.atoms} atoms)`).join('; ') || 'none'}.`,
    ]),
    `Display: ${scene.displayMode}; motion: ${scene.motion || 'unknown'}; wiggle: ${scene.wiggle.mode || 'unknown'}. Layers: ${scene.layers.slice(0, 12).map(layer => `${layer.label || layer.representation}: ${layer.representation}, ${layer.color}, ${layer.visible ? 'visible' : 'hidden'}`).join('; ') || 'none'}.`,
    'Snapshot of the current viewer, not experimental evidence. Visual wiggle is not molecular dynamics. Detailed lists may be bounded; use observation tools for a fresh state.',
  ].join('\n');
  const encoder = new TextEncoder();
  const detailBytes = encoder.encode(details);
  truncated ||= detailBytes.byteLength > 8 * 1024;
  const context = {
    content: [{ type: 'text' as const, text: new TextDecoder().decode(detailBytes.slice(0, 8 * 1024), { stream: true }) }],
    structuredContent: { burette: { ...selection.structuredContent.burette, documentId: text(input.sessionId), format: text(summary.format), counts, structures, scene, truncated } },
    // Codex presentation extension; scientific context remains standard MCP content.
    presentation: { composerAttachmentLayout: 'card' as const, composerLabel: `Burette · ${source.fileName || 'Structure'}` },
  };
  while (encoder.encode(JSON.stringify(context)).byteLength > 48 * 1024) {
    if (structures.length) structures.pop();
    else if (scene.layers.length) scene.layers.pop();
    else context.content[0].text = context.content[0].text.slice(0, Math.floor(context.content[0].text.length / 2));
    context.structuredContent.burette.truncated = true;
  }
  return context;
}
