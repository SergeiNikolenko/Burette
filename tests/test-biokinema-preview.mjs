#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function pythonHasNumpy() {
  const check = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
  return check.status === 0;
}

const tempDir = await mkdtemp(join(tmpdir(), 'burrete-biokinema-test-'));
const predictionsDir = join(tempDir, 'run_0', 'predictions');
const templatePath = join(predictionsDir, 'run_0_s0_f0_wounresol.cif');
const coordinatesPath = join(tempDir, 'run_0', 'run_0_pred_coordinates.npy');
const outputPath = join(tempDir, 'trajectory.cif');

try {
  if (!pythonHasNumpy()) {
    console.log('BioKinema preview tests skipped: numpy is not available');
    process.exit(0);
  }

  await mkdir(predictionsDir, { recursive: true });
  await writeFile(templatePath, [
    'data_run_0',
    '#',
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.type_symbol',
    '_atom_site.label_atom_id',
    '_atom_site.label_alt_id',
    '_atom_site.label_comp_id',
    '_atom_site.label_asym_id',
    '_atom_site.label_entity_id',
    '_atom_site.label_seq_id',
    '_atom_site.pdbx_PDB_ins_code',
    '_atom_site.auth_seq_id',
    '_atom_site.auth_comp_id',
    '_atom_site.auth_asym_id',
    '_atom_site.auth_atom_id',
    '_atom_site.Cartn_x',
    '_atom_site.Cartn_y',
    '_atom_site.Cartn_z',
    '_atom_site.pdbx_PDB_model_num',
    '_atom_site.id',
    '_atom_site.occupancy',
    'ATOM C CA . GLY A 1 1 ? 1 GLY A CA 0.000 0.000 0.000 1 1 1.00',
    'ATOM N N . GLY A 1 1 ? 1 GLY A N 0.000 0.000 0.000 1 2 1.00',
    '#',
    '',
  ].join('\n'));

  const npy = spawnSync('python3', ['-c', [
    'import numpy as np, sys',
    'path = sys.argv[1]',
    'coords = np.array([',
    '  [[[1, 2, 3], [4, 5, 6]]],',
    '  [[[7, 8, 9], [10, 11, 12]]],',
    '], dtype=np.float32)',
    'np.save(path, coords)',
  ].join('\n'), coordinatesPath], { encoding: 'utf8' });
  assert.equal(npy.status, 0, npy.stderr || npy.stdout);

  const extracted = spawnSync('python3', [
    'scripts/biokinema_preview_extract.py',
    tempDir,
    '--frames',
    '2',
    '--output',
    outputPath,
  ], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
  assert.match(extracted.stdout, /frames=2/);

  const cif = await readFile(outputPath, 'utf8');
  assert.match(cif, /data_run_0/);
  assert.match(cif, /ATOM C CA \. GLY A 1 1 \? 1 GLY A CA 1\.000 2\.000 3\.000 1 1 1\.00/);
  assert.match(cif, /ATOM N N \. GLY A 1 1 \? 1 GLY A N 4\.000 5\.000 6\.000 1 2 1\.00/);
  assert.match(cif, /ATOM C CA \. GLY A 1 1 \? 1 GLY A CA 7\.000 8\.000 9\.000 2 3 1\.00/);
  assert.match(cif, /ATOM N N \. GLY A 1 1 \? 1 GLY A N 10\.000 11\.000 12\.000 2 4 1\.00/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('BioKinema preview tests passed');
