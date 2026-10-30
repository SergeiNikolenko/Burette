import { test, expect, React, act, createRoot, flush, water, doc, transport, ack, bindingFor, browser } from './geometry-foundation-fixture';
import type { ShellActions } from './geometry-foundation-fixture';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import { parseXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';
import { afterAll } from 'bun:test';
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name,value] of Object.entries({ HTMLSelectElement:browser.HTMLSelectElement, HTMLButtonElement:browser.HTMLButtonElement,
  SVGElement:browser.SVGElement, HTMLFormElement:browser.HTMLFormElement, DocumentFragment:browser.DocumentFragment, KeyboardEvent:browser.KeyboardEvent })) {
  previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name)); Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
}
afterAll(()=>{for(const [name,value] of previous){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}});
const { plugin } = await import('bun');
const { transformSync } = await import('@babel/core');
const { readFileSync } = await import('node:fs');
plugin({name:'vibrational-plot-compiler',setup(build){build.onLoad({filter:/vibrational-(?:plot|spectrum)\.tsx$/},({path})=>{
 const output=transformSync(readFileSync(path,'utf8'),{filename:path,babelrc:false,configFile:false,parserOpts:{plugins:['typescript','jsx']},plugins:[['babel-plugin-react-compiler',{}]]})!;
 console.log(JSON.stringify({module:path.split('/').at(-1),compilerCacheEmitted:output.code!.includes('react/compiler-runtime')}));
 return {contents:output.code!,loader:'tsx'};
});}});
const {VibrationalPlot}=await import('../apps/desktop/src/components/workbench/vibrational-plot');


test('compiled peak-height UI preserves relative-transmission negatives and one shared scale',async()=>{
 const modes=[{index:6,frequencyCm1:1000,intensityKmMol:200},{index:7,frequencyCm1:1000,intensityKmMol:100}];
 const selections:number[]=[];const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<VibrationalPlot modes={modes} kind="ir" selected={6} onSelect={index=>selections.push(index)}/>));
  expect(host.querySelector('figcaption')?.textContent).toBe('Relative transmission (%) · cm⁻¹');
  expect(host.querySelector('figcaption')?.title).toContain('not a physical transmittance');
  expect([...host.querySelectorAll('svg text')].map(node=>node.textContent)).toContain('-200');
  expect(host.querySelectorAll('svg path')).toHaveLength(2);
  expect(host.querySelector('[aria-label="Scale factor"]')?.closest('label')?.title).toContain('(source frequency − offset) / scale factor');
  expect(host.querySelector('[aria-label="Offset, cm⁻¹"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Axis start, cm⁻¹"]')?.getAttribute('aria-valuenow')).toBe('4000');
  const slider=host.querySelector('[role="slider"][aria-label="IR peak"]')!;
  await act(async()=>slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
  expect(selections).toEqual([7]);
  const raw=host.querySelector('[role="checkbox"]') as HTMLButtonElement;
  await act(async()=>raw.click());expect(host.querySelectorAll('svg path')).toHaveLength(1);
  expect([...host.querySelectorAll('svg text')].map(node=>node.textContent)).toContain('-140');
 }finally{await act(async()=>root.unmount());host.remove();}
});

test('supplemental area curves reject overflow instead of drawing non-finite coordinates',async()=>{
 const {VibrationalSpectrum}=await import('../apps/desktop/src/components/workbench/vibrational-spectrum');
 const modes=[0,1,2].map(index=>({index,frequencyCm1:1000,intensityKmMol:1e308}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const choose=async(label:string,value:string)=>act(async()=>{const select=host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;Object.getOwnPropertyDescriptor(browser.HTMLSelectElement.prototype,'value')!.set!.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));});
 try{
  await act(async()=>root.render(<VibrationalSpectrum modes={modes} selected={null} onSelect={()=>{}}/>));
  await choose('Spectrum display','area');await choose('Line shape','gaussian');
  await act(async()=>host.querySelector('[aria-label="FWHM, cm⁻¹"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('The spectrum intensity exceeds the finite plotting range.');
  expect(host.querySelector('.workbench-spectrum path') === null).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();}
});

test('plotting keeps source rows excluded only from the selectable mode list',async()=>{
 const visible=[{index:6,frequencyCm1:1000,intensityKmMol:50}];
 const source=[{index:0,frequencyCm1:0,intensityKmMol:200},...visible];
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<VibrationalPlot modes={visible} sourceModes={source} kind="ir" selected={6} onSelect={()=>{}}/>));
  await act(async()=>host.querySelector('[aria-label="Axis end, cm⁻¹"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));
  expect([...host.querySelectorAll('svg text')].map(node=>node.textContent)).toContain('-100');
  expect(host.querySelector('[role="slider"][aria-label="IR peak"]')?.getAttribute('aria-valuemax')).toBe('1');
 }finally{await act(async()=>root.unmount());host.remove();}
});
