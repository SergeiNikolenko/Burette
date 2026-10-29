import { expect, test } from 'bun:test';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
const xyz='2\nProperties=species:S:1:pos:R:3:vel:R:3:force:R:3 velocity_unit=angstrom/fs force_unit=eV/angstrom time=20 fs temperature=300 K energy=-27.211386245988 eV\nH 0 0 0 .01 0 0 .1 0 0\nH .74 0 0 -.01 0 0 -.1 0 0';
test('extended XYZ preserves declared time, temperature, velocities and forces with explicit units',()=>{
 const f=parseScientificFile('a.xyz',xyz).frames[0];
 expect(f.energyHartree).toBeCloseTo(-1,12);
 expect(f.timePs).toBe(.02); expect(f.temperatureKelvin).toBe(300);
 expect(f.velocitiesAngstromPerPs).toEqual([[10,0,0],[-10,0,0]]);
 expect(f.forcesKcalMolAngstrom![0][0]).toBeCloseTo(2.30605478306,10);
 expect(()=>parseScientificFile('a.xyz',xyz.replace('velocity_unit=angstrom/fs',''))).toThrow('velocity_unit');
 expect(()=>parseScientificFile('a.xyz',xyz.replace('temperature=300','temperature=-300'))).toThrow('negative');
});
test('bare XYZ comments never imply units, velocity or temperature',()=>{
 const f=parseScientificFile('a.xyz','1\nenergy=-1 time=20 temperature=300\nHe 0 0 0').frames[0];
 expect(f.energyHartree).toBeUndefined(); expect(f.timePs).toBeUndefined();expect(f.temperatureKelvin).toBeUndefined();expect(f.velocitiesAngstromPerPs).toBeUndefined();
});
test('unit conversion overflow is rejected',()=>{
 expect(()=>parseScientificFile('a.xyz','1\ntime=1e308 ns\nHe 0 0 0')).toThrow('range');
 expect(()=>parseScientificFile('a.xyz',xyz.replace('.01 0 0 .1','1e308 0 0 .1'))).toThrow('range');
});
