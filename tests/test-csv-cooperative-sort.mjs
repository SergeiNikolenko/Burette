import assert from 'node:assert/strict';
import { csvSortKey, sortedRowOrderFromKeys, sortedRowOrderCooperatively } from '../apps/desktop/src/components/ui/csv-viewer-sort.ts';
const keys = Array.from({length: 12000}, (_, i) => csvSortKey(i % 3 ? String(i % 157) : `text${i % 37}`, i));
for (const descending of [false, true]) {
  let yielded = false;
  setTimeout(() => { yielded = true; }, 0);
  const result = await sortedRowOrderCooperatively(keys, descending, new AbortController().signal);
  assert.deepEqual(result, sortedRowOrderFromKeys(keys, descending));
  assert.equal(yielded, true);
}
const controller = new AbortController();
const pending = sortedRowOrderCooperatively(keys, false, controller.signal);
controller.abort();
await assert.rejects(pending, {name:'AbortError'});
console.log('Cooperative CSV sorting matches stable numeric/text order and cancels');
