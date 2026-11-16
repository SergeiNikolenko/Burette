import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';
import { buildPolymer } from '../apps/desktop/src/lib/molecular-workbench/polymer';
import { sdfFromGraph } from '../apps/desktop/src/lib/workbench/formats';
if(process.platform !== 'darwin') throw new Error('This check requires offscreen WKWebView on macOS.');
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'build/molecule-blob-preview-test');
mkdirSync(out, {recursive:true});
const parsed = parseMolecule(readFileSync(resolve(root,'tests/fixtures/polymer/chiral-reference.sdf'),'utf8'),'sdf');
const graph = buildPolymer(parsed.atoms,parsed.bonds,{head:0,tail:5,headLeaving:6,tailLeaving:11,count:500,bondLength:3});
const large = sdfFromGraph(graph.atoms,graph.bonds,'Polymer');
const reference=JSON.parse(readFileSync(resolve(root,'tests/fixtures/polymer/propylene-reference.json'),'utf8'));
const small=sdfFromGraph(reference.atoms,reference.bonds,'Propylene');
const component = resolve(root,'apps/desktop/src/components/grid-molecule-3d.tsx');
writeFileSync(resolve(out,'harness.tsx'), `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {MoleculeFilePreview} from '../../apps/desktop/src/components/molecule-file-preview';
const large=${JSON.stringify(large)}, small=${JSON.stringify(small)};
const live=new Map(), retired=[];const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=(blob)=>{const url=create(blob);live.set(url,blob);return url;};
URL.revokeObjectURL=(url)=>{live.delete(url);retired.push(url);revoke(url);};
window.blobProbe={live,retired,large,small,errors:[],csp:[]};
window.addEventListener('securitypolicyviolation', e=>window.blobProbe.csp.push({directive:e.effectiveDirective,blocked:e.blockedURI}));
window.addEventListener('message', e=>{if(e.data?.source==='burette-inspector-error')window.blobProbe.errors.push(e.data.message);});
function Harness(){const [step,setStep]=useState(0);return <><button onClick={()=>setStep(step+1)}>Next</button><output>{step}</output>{step<5&&<MoleculeFilePreview data={step===1?small:large} format="sdf" hydrogenDisplay={step>=3?"none":"all"} theme={step>=4?"dark":"light"} height={470} onOpen={()=>{}}/>}</>}
createRoot(document.getElementById('root')!).render(<Harness/>);`);
const result = await Bun.build({entrypoints:[resolve(out,'harness.tsx')],outdir:out,define:{'process.env.NODE_ENV':'"production"'},jsx:{runtime:'automatic'},plugins:[{name:'vite-assets-only',setup(build){build.onLoad({filter:/grid-molecule-3d\.tsx$/},()=>({loader:'tsx',contents:readFileSync(component,'utf8')
.replace(/import bootstrapUrl[^\n]+/,"const bootstrapUrl='/apps/desktop/src/preview-grid/molecule-preview-bootstrap.js';")
.replace(/import \{ logFrontendError \}[^\n]+/,'const logFrontendError=console.error;')
.replace(/const assets = import\.meta\.glob[^\n]+/,`const assets=Object.fromEntries(${JSON.stringify(['molstar.js','molstar.css','svg-sanitizer.js','viewer.js','viewer-shell.js','viewer-runtime.css','renderer-view-state.js','molstar-preset-preview-controller.js','color-picker.js','sequence-panel.js','native-viewer-menus.js','scene-file-actions.js'])}.map(name=>['../../../../PreviewExtension/Web/'+name,'/PreviewExtension/Web/'+name]));`)}));}}]});
if(!result.success)throw new Error(result.logs.join('\n'));
const csp=JSON.parse(readFileSync(resolve(root,'apps/desktop/src-tauri/tauri.conf.json'),'utf8')).app.security.csp;
writeFileSync(resolve(out,'index.html'),`<meta http-equiv="Content-Security-Policy" content="${csp}"><div id="root" style="width:360px"></div><script type="module" src="harness.js"></script>`);
console.log(JSON.stringify({root,bytes:large.length,csp}));

const run=spawnSync('swift',[resolve(root,'tests/molecule-file-preview-webkit.swift'),root],{stdio:'inherit',timeout:65000});
if(run.error||run.status!==0)throw run.error||new Error(`WKWebView file preview failed (${run.status})`);
