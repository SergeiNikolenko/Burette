import assert from 'node:assert/strict';
import {
  checkLoopbackBind,
  loopbackBindDiagnostic,
} from '../scripts/check-loopback-bind.mjs';

await checkLoopbackBind();

const denied = loopbackBindDiagnostic({ code: 'EACCES' });
assert.match(denied, /sandbox denies loopback listeners/);
assert.match(denied, /localhost binding permission/);
assert.doesNotMatch(denied, /port 0 in use/i);

const unexpected = loopbackBindDiagnostic({ code: 'EADDRNOTAVAIL' });
assert.match(unexpected, /loopback preflight failed \(EADDRNOTAVAIL\)/);

console.log('loopback bind preflight tests passed');
