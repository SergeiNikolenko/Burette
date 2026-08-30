import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  desktopManualChunks,
  ketcherDisabledMacromoleculesPlugin,
} from "../apps/desktop/vite/build-plugins.ts";

const disabledMacromoleculesPlugin = ketcherDisabledMacromoleculesPlugin();
const ketcherSource = readFileSync(
  new URL("../apps/desktop/node_modules/ketcher-react/dist/index.js", import.meta.url),
  "utf8",
);
const transformedKetcher = disabledMacromoleculesPlugin.transform(
  ketcherSource,
  "/repo/node_modules/ketcher-react/dist/index.js",
);

assert.ok(transformedKetcher);
assert.match(transformedKetcher.code, /!props\.disableMacromoleculesEditor && ketcherId/);
assert.throws(
  () => disabledMacromoleculesPlugin.transform("unexpected Ketcher source", "/repo/node_modules/ketcher-react/dist/index.js"),
  /Expected one Ketcher macromolecules mount, found 0/,
);
assert.equal(
  disabledMacromoleculesPlugin.transform(ketcherSource, "/repo/node_modules/ketcher-core/dist/index.js"),
  null,
);

assert.equal(desktopManualChunks("/repo/node_modules/ketcher-react/dist/index.js"), undefined);
assert.equal(desktopManualChunks("/repo/node_modules/ketcher-react/node_modules/ketcher-core/dist/index.js"), undefined);
assert.equal(desktopManualChunks("/repo/node_modules/ketcher-react/node_modules/react/index.js"), undefined);
assert.equal(desktopManualChunks("/repo/node_modules/molstar/lib/mol-model/structure.js"), "molstar");
assert.equal(desktopManualChunks("/repo/node_modules/molstar/node_modules/react/index.js"), undefined);
assert.equal(desktopManualChunks("C:\\repo\\node_modules\\eve-raphael\\eve.js"), undefined);

console.log("Vite build plugin tests passed");
