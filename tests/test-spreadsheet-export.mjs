import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spreadsheetCell } from '../apps/desktop/src/lib/spreadsheet-csv.ts';
import { parseCsv } from '../apps/desktop/src/lib/csv.ts';
import { csvViewerDownloadActions, serializeCsvTable } from '../apps/desktop/src/components/ui/csv-viewer-download.ts';
import { createXlsxSheetCsvExportAction } from '../apps/desktop/src/components/ui/xlsx-viewer-download.ts';

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const gridCell = new Function(declaration('spreadsheetCell') + ';return spreadsheetCell;')();
const dangerous = ['=SUM(1,2)', '+cmd', '-1+2', '@SUM(1)', '\t=1', '\r\n+1+2', '\u00a0\ufeff=1', '\u0085@x', '＝1', '＋cmd', '－1+2', '＠x'];
const ordinary = ['CCO', '[O-]', '−1', '-12', '-.5', '-1.2e-9', '+2.5', '-0', '\t-1\r', '-1e9999', 'text,"quoted"\r\n', "'already text", ''];
for (const value of [...dangerous, ...ordinary]) {
  const expected = dangerous.includes(value) ? "'" + value : value;
  assert.equal(spreadsheetCell(value), expected);
  assert.equal(gridCell(value), expected);
}

const rows = [{index:0,name:'=SUM(1,2)',smiles:'[O-]',molblock:'',props:{'=header':'@value',energy:'-1.2e-9',note:'\t=1'}}];
const before = structuredClone(rows), downloads = [], posts = [];
const state = {sourceRevision:7,closeTransitionActive:false,saveAsPending:false};
const names = ['withSarProperties','serializeDelimitedRows','gridDelimitedCell','spreadsheetCell','csv','gridSaveAsSnapshot','exportCSV','saveGrid','saveGridAs'];
const grid = new Function('state','download','collectExportRows','capabilities','requireCollectionIndexReady','collectCurrentCollectionRows','canUseNativeBridge','post','baseName','syncGridEditControls','updateChrome','markGridClean','setStatus',
  names.map(declaration).join('\n') + ';return {exportCSV,saveGrid,saveGridAs};'
)(state, (text,name)=>downloads.push({text,name}), async()=>rows, ()=>({editing:true}), ()=>true, async()=>rows, ()=>true,
  (type,_,payload)=>posts.push({type,payload}), ()=>'molecules', ()=>{}, ()=>{}, ()=>{}, ()=>{});
await grid.exportCSV({label:'molecules.csv',format:'csv'});
await grid.saveGrid({label:'molecules.csv',format:'csv'});
await grid.saveGridAs({label:'molecules.csv',format:'csv'});
const exported = parseCsv(downloads[0].text);
assert.deepEqual(exported.columns,['burette_encoding','index','name','smiles','molblock',"'=header",'energy','note']);
assert.deepEqual(exported.rows[0],['escaped-v1','0',"'=SUM(1,2)",'[O-]','',"'@value",'-1.2e-9',"'\\t=1"]);
assert.deepEqual(posts.map(({type})=>type),['saveGrid','saveGridAs']);
for (const {payload} of posts) {
  const saved = parseCsv(payload.text);
  assert.equal(saved.columns[5],'=header');
  assert.deepEqual(saved.rows[0],['escaped-v1','0','=SUM(1,2)','[O-]','','@value','-1.2e-9','\\t=1']);
}
assert.deepEqual(rows,before,'export and persistence never rewrite source rows');
for (const delimiter of [',','\t',';']) {
  const text = serializeCsvTable({columns:['=column','numeric','quoted'],sourceRows:[['\t@value','-0.5','text,"x"\r\nnext']],dialect:{delimiter,hasHeader:true}});
  assert.deepEqual(parseCsv(text,{delimiter}),{columns:["'=column",'numeric','quoted'],rows:[["'\t@value",'-0.5','text,"x"\r\nnext']]});
}
const original = {id:'original',label:'Original',getPayload:()=>({kind:'text',text:'=untouched'})};
const actions = csvViewerDownloadActions({resource:{originalDownload:original},columns:['name'],sourceRows:[['=1']],dialect:{delimiter:',',hasHeader:true},fileName:'data.csv',canExportTable:true});
assert.equal(actions[0].getPayload().text,'=untouched');
assert.equal(parseCsv(actions[1].getPayload().text).rows[0][0],"'=1");
const sheet = createXlsxSheetCsvExportAction({fileName:'sheet.csv',sheetIndex:0,getSource:async()=>({sheets:[{rowCount:1,columnCount:2}],getCell:(_,__,column)=>({text:column ? '-2.5' : '=1+1'})})});
assert.deepEqual(parseCsv((await sheet.getPayload()).text).rows,[["'=1+1",'-2.5']]);
console.log('Spreadsheet exports neutralize formulas; Save, Save As, originals and numeric data remain intact.');
