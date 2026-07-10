import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SOURCE_ROOT = path.join(
  path.dirname(require.resolve("molstar/package.json")),
  "build/viewer",
);
const OUTPUT_ROOT = path.join(APP_ROOT, "public/molstar");

const EXPECTED_JAVASCRIPT_SHA256 =
  "aa6ffbbcf6f544755d3703144f8f30c5cf2183216a2162e5fd6349f03d2c57d9";
const EXPECTED_CSS_SHA256 =
  "9269edea08fd43848229b971d8102df163858a76417c6823d987b8e25df127f9";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Expected exactly one Mol* ${label} expression.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

async function main() {
  const [javascriptSource, cssSource] = await Promise.all([
    readFile(path.join(SOURCE_ROOT, "molstar.js"), "utf8"),
    readFile(path.join(SOURCE_ROOT, "molstar.css"), "utf8"),
  ]);

  if (sha256(javascriptSource) !== EXPECTED_JAVASCRIPT_SHA256) {
    throw new Error("Mol* JavaScript changed; review the CSP patch before building.");
  }
  if (sha256(cssSource) !== EXPECTED_CSS_SHA256) {
    throw new Error("Mol* CSS changed; review the pinned asset before building.");
  }

  let javascript = javascriptSource;
  javascript = replaceExactlyOnce(
    javascript,
    'new Function("body","return function "+T+`() {\n    "use strict";    return body.apply(this, arguments);\n};\n`)(M)',
    "function(){return M.apply(this,arguments)}",
    "named-function",
  );
  javascript = replaceExactlyOnce(
    javascript,
    'new Function("dynCall","rawFunction",Be+`};\n`)(W,M)',
    "function(dynCall,rawFunction){return function(){return dynCall.apply(null,[rawFunction].concat(Array.prototype.slice.call(arguments)))}}(W,M)",
    "dynamic-call",
  );
  javascript = replaceExactlyOnce(
    javascript,
    'new Function(""+d)',
    'function(){throw new TypeError("String callbacks are not supported")}',
    "string-callback",
  );
  javascript = replaceExactlyOnce(
    javascript,
    'new Function(...r,`return \\`${e}\\`;`)(...n)',
    'e.replace(/\\$\\{([^}]+)\\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(t,k)?String(t[k]):m)',
    "template-interpolation",
  );
  javascript = replaceExactlyOnce(
    javascript,
    "let i=r.n(n)()(),a=new Promise(s=>{i.then(()=>{s()})}),A=()=>o(void 0,void 0,void 0,(function*(){yield a;let s=new i.H264MP4Encoder;return s.FS=i.FS,s}))",
    "let i,a,A=()=>o(void 0,void 0,void 0,(function*(){if(!i){i=r.n(n)()();a=new Promise(s=>{i.then(()=>{s()})})}yield a;let s=new i.H264MP4Encoder;return s.FS=i.FS,s}))",
    "eager-h264-initialization",
  );
  javascript = javascript.replace(/\n\/\/# sourceMappingURL=molstar\.js\.map\s*$/u, "\n");

  if (javascript.includes("new Function")) {
    throw new Error("The generated Mol* asset still contains dynamic code generation.");
  }

  const css = cssSource.replace(
    /\n\/\*# sourceMappingURL=molstar\.css\.map \*\/\s*$/u,
    "\n",
  );

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await Promise.all([
    writeFile(path.join(OUTPUT_ROOT, "molstar.js"), javascript),
    writeFile(path.join(OUTPUT_ROOT, "molstar.css"), css),
  ]);
  console.log("Generated CSP-compatible Mol* 5.7.0 assets.");
}

await main();
