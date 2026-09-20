import assert from 'node:assert/strict';
import { renderPropertyGroups, readRenderProperty, setRenderProperty, splitRenderArguments } from '../apps/desktop/src/lib/xyzrender-properties.ts';
import { xyzrenderAnimationArguments } from '../apps/desktop/vite/browser-dev/xyzrender-animation-options.ts';
import { rotateXyzrenderReference } from '../apps/desktop/vite/browser-dev/xyzrender-orientation.ts';
const fields = renderPropertyGroups.flatMap(group => group.fields);
const field = name => fields.find(field => field.flag === name);
let controls = { extraArguments: '--ts --overlay "/tmp/reference structure.xyz" --unknown-option 2' };
controls = setRenderProperty(controls, field('--radius-scale'), '1-6 1.4\nFe 2');
assert.deepEqual(splitRenderArguments(controls.extraArguments), ['--ts','--overlay','/tmp/reference structure.xyz','--unknown-option','2','--radius-scale','1-6','1.4','--radius-scale','Fe','2']);
assert.equal(readRenderProperty(controls, field('--radius-scale')), '1-6 1.4\nFe 2');
controls = setRenderProperty(controls, field('--radius-scale'), '');
assert.equal(readRenderProperty(controls, field('--radius-scale')), '');
assert.equal(readRenderProperty(controls, field('--overlay')), '/tmp/reference structure.xyz');
controls = setRenderProperty(controls, field('-l'), '1 "active site"');
assert.equal(readRenderProperty(controls, field('-l')), '1 "active site"');
assert.deepEqual(splitRenderArguments(setRenderProperty(controls, field('-l'), readRenderProperty(controls, field('-l'))).extraArguments).slice(-3), ['-l', '1', 'active site']);
assert.deepEqual(xyzrenderAnimationArguments({mode:'bounce',axis:'-xy',amplitude:30,frames:72,size:640},'/tmp/a.gif'), ['-S','640','--gif-fps','10','--rot-frames','72','-go','/tmp/a.gif','--gif-bounce','30,-xy']);
assert.ok(xyzrenderAnimationArguments({mode:'vibration',rotate:true,axis:'z'},'a.gif').includes('--gif-ts'));
assert.ok(xyzrenderAnimationArguments({mode:'trajectory',rebuildBonds:true},'a.gif').includes('--trj-bonds'));
assert.ok(xyzrenderAnimationArguments({mode:'assembly',anchor:'1-5,8',forward:true},'a.gif').includes('--anchor'));
assert.throws(() => xyzrenderAnimationArguments({mode:'rotation',axis:'invalid'},'a.gif'));
for (const mode of ['rotation', 'trajectory', 'vibration', 'assembly']) {
  assert.ok(xyzrenderAnimationArguments({ mode, rotate: true, axis: '-x' }, 'a.gif').includes('--gif-rot=-x'));
}
assert.throws(() => xyzrenderAnimationArguments({size:1024,frames:120},'a.gif'));
const rotated = rotateXyzrenderReference('2\nreference\nC -1 0 0\nO 1 0 0\n', [0,0,90]);
assert.equal(rotated, '2\nBurette orientation\nC -0.000000000 -1.000000000 0.000000000\nO 0.000000000 1.000000000 0.000000000\n');
assert.throws(() => rotateXyzrenderReference('1\nx\nH NaN 0 0', [0,0,0]));
console.log('xyzrender editor options passed');
