import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const require = createRequire(import.meta.url);

// The hosted viewer ships the Mol* build this repository vendors, not the one
// inside node_modules. Since 5.11 `scripts/vendor-molstar.mjs` bundles Mol*
// itself through Bun.build, and that bundle is what PreviewExtension/Web serves
// and what vendor-assets.lock.json checksums. Reading node_modules here meant
// this build inspected a file the hosted plugin never loads, and it broke
// whenever the two drifted apart.
const SOURCE_ROOT = path.join(REPO_ROOT, "PreviewExtension/Web");
const OUTPUT_ROOT = path.join(APP_ROOT, "public/burette-viewer");

// The version comes from the workspace root, which is what the vendored bundle
// was built from. Resolving it through this package finds the nested copy this
// app happens to carry, which trails the root by a minor version.
const MOLSTAR_VERSION = require(path.join(REPO_ROOT, "package.json")).dependencies?.molstar
  ?? "unknown";

async function main() {
  const [javascriptSource, cssSource] = await Promise.all([
    readFile(path.join(SOURCE_ROOT, "molstar.js"), "utf8"),
    readFile(path.join(SOURCE_ROOT, "molstar.css"), "utf8"),
  ]);

  const javascript = javascriptSource.replace(
    /\n\/\/# sourceMappingURL=molstar\.js\.map\s*$/u,
    "\n",
  );

  // The whole point of this step: the hosted plugin runs under a CSP without
  // 'unsafe-eval'. Upstream's own viewer bundle needed five hand-written
  // rewrites to get here; the Bun bundle arrives with none of these left, so
  // the assertion is the contract rather than the patches. If a future Mol*
  // reintroduces one, this fails loudly instead of shipping a viewer that dies
  // in the browser.
  if (javascript.includes("new Function")) {
    throw new Error(
      "The vendored Mol* bundle contains dynamic code generation, which the hosted CSP forbids. " +
        "Re-run `bun run vendor:molstar`, and if it persists, patch the offending call before building.",
    );
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
  console.log(`Generated CSP-compatible Mol* ${MOLSTAR_VERSION} assets.`);
}

await main();
