import assert from "node:assert/strict";

import { desktopManualChunks } from "../apps/desktop/vite/build-plugins.ts";

assert.equal(desktopManualChunks("/repo/node_modules/ketcher-react/dist/index.js"), undefined);
assert.equal(desktopManualChunks("/repo/node_modules/ketcher-react/node_modules/ketcher-core/dist/index.js"), undefined);
assert.equal(desktopManualChunks("/repo/node_modules/ketcher-react/node_modules/react/index.js"), undefined);
assert.equal(desktopManualChunks("/repo/node_modules/molstar/lib/mol-model/structure.js"), "molstar");
assert.equal(desktopManualChunks("/repo/node_modules/molstar/node_modules/react/index.js"), undefined);
assert.equal(desktopManualChunks("C:\\repo\\node_modules\\eve-raphael\\eve.js"), undefined);

console.log("Vite build plugin tests passed");
