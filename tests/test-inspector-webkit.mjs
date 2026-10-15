// Native renderer regression, without building or launching Burette.
// bun tests/test-inspector-webkit.mjs (macOS only)
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
if (process.platform !== 'darwin') throw new Error('This check requires WKWebView on macOS.');
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'build/inspector-webkit-test');
await mkdir(dir, { recursive: true });
try {
  const source = await readFile(resolve(root, 'apps/desktop/src/components/grid-molecule-3d.tsx'), 'utf8');
  // Keep the production component and external bootstrap; replace only Vite's
  // asset imports and the Tauri logger for this standalone WKWebView host.
  const component = source.replace(/import bootstrapUrl[^\n]+/, "const bootstrapUrl='/apps/desktop/src/preview-grid/molecule-preview-bootstrap.js';")
    .replace(/import \{ logFrontendError \}[^\n]+/, 'const logFrontendError=console.error;')
    .replace(/const assets = import.meta.glob[^\n]+/, `const assets = Object.fromEntries(${JSON.stringify(['molstar.js','molstar.css','viewer.js','viewer-shell.js','viewer-runtime.css','renderer-view-state.js','molstar-preset-preview-controller.js','color-picker.js','sequence-panel.js','native-viewer-menus.js','scene-file-actions.js'])}.map(name=>['../../../../PreviewExtension/Web/'+name,'/PreviewExtension/Web/'+name]));`)
    .replace('export default function', 'function');
  const molecules = await Promise.all(['samples/mini.sdf', 'samples/structures/small-molecules/caffeine.sdf'].map(async path => (await readFile(resolve(root, path), 'utf8')).split('M  END')[0]+'M  END\n'));
  await writeFile(resolve(dir, 'harness.tsx'), component + `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
const molecules=${JSON.stringify(molecules)};
function Harness(){const[index,setIndex]=useState(0);return <><button onClick={()=>setIndex(index+1)}>Next</button><output>{index}</output><GridMolecule3D molblock={molecules[index%2]} theme="light" height={470} onOpen={()=>{}}/></>}
createRoot(document.getElementById('root')!).render(<Harness/>);`);
  const result = await Bun.build({entrypoints:[resolve(dir,'harness.tsx')],outdir:dir,define:{'process.env.NODE_ENV':'"production"'},jsx:{runtime:'automatic'}});
  if (!result.success) throw new Error(result.logs.join('\n'));
  await writeFile(resolve(dir,'index.html'), '<div id="root" style="width:360px"></div><script type="module" src="harness.js"></script>');
  const run = spawnSync('swift', [resolve(root,'tests/inspector-webkit-smoke.swift'), root], {stdio:'inherit',timeout:65000});
  if (run.error || run.status !== 0) throw run.error || new Error(`WKWebView regression failed (${run.status})`);
} finally { await rm(dir, {recursive:true,force:true}); }
