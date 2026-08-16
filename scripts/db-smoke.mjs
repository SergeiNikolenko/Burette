#!/usr/bin/env node
// Live smoke test for the keyless Database providers. Deliberately kept out of
// CI: it talks to third-party services, so a red run means "the service moved or
// is down", not "the build is broken". Run it by hand after touching a provider,
// and with --record to refresh the parser fixtures under tests/fixtures/database.
//
//   node scripts/db-smoke.mjs
//   node scripts/db-smoke.mjs --record
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = resolve(root, 'tests/fixtures/database');
const record = process.argv.includes('--record');
const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length);

const ASPIRIN = 'CC(=O)Oc1ccccc1C(=O)O';
const CHEMBL_ONLY = 'molecule_chembl_id,pref_name,max_phase,similarity,molecule_structures,molecule_properties';

const checks = [
  {
    name: 'chembl-similarity',
    fixture: 'chembl-similarity.json',
    url: `https://www.ebi.ac.uk/chembl/api/data/similarity/${encodeURIComponent(ASPIRIN)}/80.json?limit=5&only=${CHEMBL_ONLY}`,
    verify: (text) => {
      const payload = JSON.parse(text);
      assert(Array.isArray(payload.molecules) && payload.molecules.length > 0, 'molecules array');
      assert(payload.molecules[0].molecule_chembl_id?.startsWith('CHEMBL'), 'molecule_chembl_id');
      assert(typeof payload.molecules[0].molecule_structures?.canonical_smiles === 'string', 'canonical_smiles');
      return `${payload.molecules.length} molecules`;
    },
  },
  {
    name: 'chembl-substructure',
    fixture: 'chembl-substructure.json',
    url: `https://www.ebi.ac.uk/chembl/api/data/substructure/${encodeURIComponent('c1ccccc1C(=O)O')}.json?limit=5&only=${CHEMBL_ONLY}`,
    verify: (text) => {
      const payload = JSON.parse(text);
      assert(Array.isArray(payload.molecules) && payload.molecules.length > 0, 'molecules array');
      return `${payload.molecules.length} molecules`;
    },
  },
  {
    name: 'chembl-activity',
    fixture: 'chembl-activity.json',
    url: 'https://www.ebi.ac.uk/chembl/api/data/activity.json?molecule_chembl_id__in=CHEMBL25,CHEMBL521&limit=5&only=molecule_chembl_id,target_chembl_id,target_pref_name,standard_type,standard_value,standard_units,pchembl_value',
    verify: (text) => {
      const payload = JSON.parse(text);
      assert(Array.isArray(payload.activities) && payload.activities.length > 0, 'activities array');
      return `${payload.activities.length} activities`;
    },
  },
  {
    name: 'cod-text',
    fixture: 'cod-result.json',
    url: 'https://www.crystallography.net/cod/result?format=json&text=aspirin',
    trim: (text) => JSON.stringify(JSON.parse(text).slice(0, 5)),
    verify: (text) => {
      const payload = JSON.parse(text);
      assert(Array.isArray(payload) && payload.length > 0, 'result array');
      assert(payload[0].file, 'COD id');
      return `${payload.length} entries`;
    },
  },
  {
    name: 'wikipedia-idcodes',
    fixture: 'wikipedia-idcode.txt',
    url: 'https://wikipedia.cheminfo.org/idcode.txt',
    trim: (text) => `${text.split('\n').slice(0, 40).join('\n')}\n`,
    verify: (text) => {
      const rows = text.split('\n').filter(Boolean);
      assert(rows.length > 100, 'idcode rows');
      assert(rows[0].includes('\t'), 'tab separated');
      return `${rows.length} idcodes`;
    },
  },
  {
    name: 'building-blocks',
    fixture: 'building-blocks.tsv',
    url: 'https://bb.datawarrior.org/?what=query&smiles=c1cncnc1OC&maxrows=5',
    verify: (text) => {
      const rows = text.split('\n').filter(Boolean);
      assert(rows[0].startsWith('Product-ID'), 'building block header');
      return `${rows.length - 1} products`;
    },
  },
  {
    name: 'google-patents',
    fixture: 'google-patents.json',
    url: 'https://patents.google.com/xhr/query?url=q%3Daspirin',
    trim: (text) => {
      const payload = JSON.parse(text);
      for (const cluster of payload.results?.cluster ?? []) {
        cluster.result = (cluster.result ?? []).slice(0, 3);
      }
      return JSON.stringify(payload);
    },
    verify: (text) => {
      const payload = JSON.parse(text);
      const results = payload.results?.cluster?.[0]?.result ?? [];
      assert(results.length > 0, 'patent results');
      assert(results[0].patent?.title, 'patent title');
      return `${payload.results.total_num_results} hits`;
    },
  },
];

function assert(condition, what) {
  if (!condition) throw new Error(`missing ${what}`);
}

function get(url) {
  return execFileSync('/usr/bin/curl', [
    '--fail', '--location', '--silent', '--show-error',
    '--max-time', '90', '--user-agent', 'Burette/1.0', url,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

let failures = 0;
if (record) mkdirSync(fixtures, { recursive: true });
for (const check of checks) {
  if (only && check.name !== only) continue;
  process.stdout.write(`${check.name.padEnd(22)}`);
  try {
    const text = get(check.url);
    const summary = check.verify(text);
    if (record) {
      writeFileSync(resolve(fixtures, check.fixture), check.trim ? check.trim(text) : text);
      process.stdout.write(`ok (${summary}) -> tests/fixtures/database/${check.fixture}\n`);
    } else {
      process.stdout.write(`ok (${summary})\n`);
    }
  } catch (error) {
    failures += 1;
    process.stdout.write(`FAILED ${error.message.split('\n')[0]}\n`);
  }
}
process.exit(failures === 0 ? 0 : 1);
