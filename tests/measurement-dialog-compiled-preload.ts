import { plugin } from "bun";
import { afterAll, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";

// The measurement dialog, its host route and the shared graph history through the production compiler pass.
const compiled = new Set<string>();
plugin({ name: "measurement-dialog-compiler", setup(build) {
  build.onLoad({ filter: /(?:components\/workbench\/measurement-coordinate-(?:dialog|host)\.tsx|lib\/workbench\/use-graph-draft\.ts|hooks\/use-app-viewer-state-messages\.ts)$/u }, ({ path }) => {
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    // The dialog body bails out of memoization (try/finally, throw inside try); the host must not.
    if (!result?.code || (path.endsWith("-host.tsx") && !result.code.includes("react/compiler-runtime"))) throw new Error(`${path} did not compile with a cache.`);
    compiled.add(path.split("/").pop()!);
    return { contents: result.code, loader: path.endsWith(".tsx") ? "tsx" : "ts" };
  });
} });
afterAll(() => { expect([...compiled].sort()).toEqual(["measurement-coordinate-dialog.tsx", "measurement-coordinate-host.tsx", "use-app-viewer-state-messages.ts", "use-graph-draft.ts"]); });
