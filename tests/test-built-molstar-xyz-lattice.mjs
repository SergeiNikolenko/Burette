import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";
const [bundleArg, viewerArg, lane = "selected"] = process.argv.slice(2);
const bundlePath = bundleArg || fileURLToPath(new URL("../PreviewExtension/Web/molstar.js", import.meta.url));
const viewerPath = viewerArg || fileURLToPath(new URL("../PreviewExtension/Web/viewer.js", import.meta.url));
const dom = new Window({ url: "https://burette-test.invalid/" });
Object.assign(dom, { setImmediate, clearImmediate });
const context = vm.createContext({ console, assert, document: dom.document, window: dom, self: dom,
  navigator: dom.navigator, location: dom.location, crypto, TextEncoder, TextDecoder,
  Blob: dom.Blob, File: dom.File, FileReader: dom.FileReader, URL, URLSearchParams,
  ArrayBuffer, SharedArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
  atob, btoa, performance, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask,
  requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout,
  HTMLElement: dom.HTMLElement, HTMLCanvasElement: dom.HTMLCanvasElement, HTMLImageElement: dom.HTMLImageElement,
  Image: dom.Image, Event: dom.Event, CustomEvent: dom.CustomEvent, AbortController, AbortSignal,
  quoteCases: JSON.parse(readFileSync(new URL("./fixtures/xyz-lattice/quoted-cases.json", import.meta.url), "utf8")),
  sourceText: readFileSync(new URL("./fixtures/xyz-lattice/frame-owned-lattice.xyz", import.meta.url), "utf8"),
  oracle: JSON.parse(readFileSync(new URL("./fixtures/xyz-lattice/expected.json", import.meta.url), "utf8")),
  viewerSource: readFileSync(viewerPath, "utf8"), lane,
});
try {
 const bytes = readFileSync(bundlePath);
 vm.runInContext(bytes.toString("utf8"), context, { filename: "complete-built-molstar.js", timeout: 30000 });
 const result = await vm.runInContext(readFileSync(new URL("./fixtures/xyz-lattice/native-body.js", import.meta.url), "utf8"), context, { filename: "full-iife-proof-body.js" });
 const quotedMetadata = await vm.runInContext(readFileSync(new URL("./fixtures/xyz-lattice/quoted-metadata-body.js", import.meta.url), "utf8"), context, { filename: "native-xyz-quoted-metadata.js" });
 console.log(JSON.stringify({ lane, bundleSha256: createHash("sha256").update(bytes).digest("hex"), bundleBytes: bytes.length, result, quotedMetadata }));
} catch (error) {
 console.error(JSON.stringify({ lane, name: error.name, message: error.message, stack: String(error.stack).split("\n").slice(0, 8) }));
 process.exitCode = 1;
} finally { await dom.happyDOM.close(); }
