import { expect, test } from 'bun:test';
import { PickBuffers } from '@molstar/graphics/canvas3d/passes/pick';
import { importMolstarModuleVariant } from './fixtures/molstar-module-variant.mjs';
import { patchMolstarPickReadback } from '../scripts/molstar-pick-readback.mjs';
import { readMolstarModule } from '../scripts/molstar-source.mjs';

const specifier = '@molstar/graphics/canvas3d/helper/pick-helper';
const { PickHelper: UpstreamPickHelper } = await importMolstarModuleVariant(specifier);
const { PickHelper } = await importMolstarModuleVariant(specifier, patchMolstarPickReadback);

// Use the real buffer readiness state and helper methods, replacing GPU transport
// and world-coordinate conversion. Hover starts a read before a primary click.
function pendingHover(Helper, synchronous = true) {
  let status = 'pending';
  const reader = {
    synchronous, asynchronous: true,
    reset() {}, start() {},
    check(arrays) {
      if (status === 'resolved') arrays.forEach(array => array.set([0, 0, 8, 0]));
      return status;
    },
  };
  const buffers = new PickBuffers({}, { getTextures: () => [] }, reader);
  buffers.setViewport(0, 0, 1, 1);
  buffers.asyncRead();
  const helper = Object.assign(Object.create(Helper.prototype), {
    buffers, dirty: false, incomplete: false, disposed: false,
    prepare() {},
    getPickData() { return buffers.getPickingId(0, 0); },
  });
  return { helper, settle(value) { status = value; } };
}

test('a click waits for the hover read on synchronous and asynchronous backends', () => {
  const original = pendingHover(UpstreamPickHelper);
  expect(original.helper.identify(0, 0, {})).toBeUndefined();
  for (const synchronous of [true, false]) {
    const { helper, settle } = pendingHover(PickHelper, synchronous);
    expect(helper.identify(0, 0, {})).toBe('pending');
    const click = helper.asyncIdentify(0, 0, {});
    expect(click.tryGet()).toBe('pending');
    settle('resolved');
    expect(click.tryGet()).toEqual({ objectId: 7, instanceId: 7, groupId: 7 });
    expect(helper.identify(0, 0, {})).toEqual({ objectId: 7, instanceId: 7, groupId: 7 });
    helper.buffers.arrays.forEach(array => array.fill(0));
    expect(helper.identify(0, 0, {})).toBeUndefined();
  }
});

test('a failed read requests a fresh render and a disposed pending pick yields nothing', () => {
  const { helper, settle } = pendingHover(PickHelper);
  const click = helper.asyncIdentify(0, 0, {});
  settle('failed');
  expect(helper.identify(0, 0, {})).toBe('pending');
  expect(helper.dirty).toBe(true);
  helper.disposed = true;
  expect(click.tryGet()).toBeUndefined();
});

test('the source adapter rejects changed or already patched upstream code', async () => {
  const source = await readMolstarModule(specifier);
  expect(() => patchMolstarPickReadback('changed source')).toThrow('review pending clicks');
  expect(() => patchMolstarPickReadback(patchMolstarPickReadback(source))).toThrow('review pending clicks');
});
