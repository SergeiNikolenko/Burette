import { expect, test } from "bun:test";
import { readOrcaVcdTables, readOrcaMcdBlocks } from "../apps/desktop/src/lib/molecular-workbench/orca-circular-spectra";
const modes = [{index: 6, frequencyCm1: 0}, {index: 9, frequencyCm1: -123.456}];
const table = (rows: string) => `VCD SPECTRUM\n---\nMode Freq R\ncm**-1\n---\n${rows}\n\n`;

test("independent: indexed source correspondence preserves zero, negative frequency, signed signal and absent calculations", () => {
 const result=readOrcaVcdTables(table("9: -123.46 -2.5D-2\n6: 0 -0"),modes);
 expect(result.map(t=>t.spectrum)).toEqual([{kind:"vcd",xUnit:"cm^-1",positions:[-123.456,0],values:[-0.025,-0],valueUnit:null,sourceRowIds:["9","6"],auxiliary:[{name:"printed frequency",unit:"cm^-1",values:[-123.46,0]}]}]);
 expect(Object.is(result[0].spectrum.values[1],-0)).toBe(true);
 expect(()=>readOrcaVcdTables(table("8: -123.46 1"),[{index:9,frequencyCm1:-123.456}])).toThrow();
 expect(()=>readOrcaVcdTables(table("6: 0"),modes)).toThrow();
 expect(()=>readOrcaVcdTables(table("6: 0 0")+table("9: -123.46 BAD"),modes)).toThrow();
});

test("independent: accumulated rows bound all VCD tables, without filling absent modes", () => {
 const row=table("6: 0 1");
 expect(readOrcaVcdTables(row.repeat(10000),modes).length).toBe(10000);
 expect(()=>readOrcaVcdTables(row.repeat(10001),modes)).toThrow("10,000");
 expect(()=>readOrcaVcdTables(table("6: 0 1"),[{index:6,frequencyCm1:0},{index:6,frequencyCm1:0}])).toThrow();
});

test("independent: MCD keeps equal-frequency triples and refuses any malformed later block", () => {
 const source="1 -0 -2 1 +3 -0 0 -4 5";
 expect(readOrcaMcdBlocks(source).map(t=>t.spectrum)).toEqual([
 {kind:"mcd",xUnit:"cm^-1",positions:[1,1],values:[-0,3],valueUnit:null,auxiliary:[{name:"absorption",unit:null,values:[-2,-0]}]},
 {kind:"mcd",xUnit:"cm^-1",positions:[0],values:[-4],valueUnit:null,auxiliary:[{name:"absorption",unit:null,values:[5]}]}
 ]);
 for(const suffix of [" 0 1", " 0 BAD 2", " 0 1 Infinity", " 0 1 2\0"]){expect(()=>readOrcaMcdBlocks("1 2 3"+suffix)).toThrow();}
});

test("independent: a malformed VCD section cannot consume the next section's columns", () => {
 const malformedThenValid="VCD SPECTRUM\n---\n\n"+table("6: 0 1");
 expect(()=>readOrcaVcdTables(malformedThenValid,modes)).toThrow();
});
