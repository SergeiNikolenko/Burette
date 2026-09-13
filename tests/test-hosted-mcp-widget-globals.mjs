import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isHostedMcpToolResultMessage, parseHostedMcpStructureMessage, parseHostedMcpStructureResult, selectHostedMcpInitialStructure } from "../apps/desktop/src/lib/hosted-mcp-widget.ts";

// Run the actual hook with the host/event and document-opening boundaries
// stubbed. The real parser still validates split metadata and invalid results.
const hookCode = ts.transpileModule(readFileSync(new URL(
  "../apps/desktop/src/hooks/use-hosted-mcp-widget.ts", import.meta.url,
), "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
for (const metadataFirst of [false, true]) {
  const listeners = new Map();
  const opened = [];
  const added = [];
  let cleared = 0;
  let cleanup;
  const hostWindow = {
    parent: {}, __BURETTE_HOSTED_MCP_RESULTS__: [],
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
  };
  const modules = {
    react: { useRef: value => ({ current: value }), useEffect: effect => { cleanup = effect(); } },
    "../lib/browser-dev-documents": {
      deleteBrowserDevVirtualTextDocument() {},
      openBrowserDevMolstarContextDocument: async input => {
        opened.push(input);
        return { path: "/fixture.pdb" };
      },
    },
    "../lib/hosted-mcp-widget": {
      isHostedMcpWidget: () => true, isHostedMolecularViewerWidget: () => true,
      isHostedMcpToolResultMessage, parseHostedMcpStructureMessage,
      parseHostedMcpStructureResult, selectHostedMcpInitialStructure,
    },
  };
  const exports = {};
  runInNewContext(hookCode, {
    exports, window: hostWindow, document: { documentElement: { dataset: {} } },
    require: name => { assert.ok(modules[name], name); return modules[name]; },
  });
  exports.useHostedMcpWidget({
    addDocuments: rows => added.push(...rows), closeAllDocuments: () => cleared++,
    preferences: {}, pushErrorStatus: error => { throw error; },
  });
  const output = { toolOutput: { fileName: "split.pdb" } };
  const metadata = { toolResponseMetadata: { structure: { data: "ATOM\nEND\n", format: "pdb", label: "split.pdb" } } };
  const dispatch = globals => listeners.get("openai:set_globals")({ detail: { globals } });
  dispatch(metadataFirst ? metadata : output);
  if (!metadataFirst) assert.equal(cleared, 0, "partial output must not clear the viewer");
  dispatch(metadataFirst ? output : metadata);
  await Promise.resolve();
  assert.equal(opened.length, 1, "split host updates open the structure exactly once");
  assert.equal(added.length, 1);
  assert.equal(opened[0].entries[0].data, "ATOM\nEND\n");
  dispatch({ theme: "dark" });
  dispatch(metadata);
  assert.equal(opened.length, 1, "theme and duplicate metadata preserve the current renderer");
  assert.equal(cleared, 1);
  dispatch({ toolResponseMetadata: null });
  assert.equal(cleared, 2, "explicitly removed metadata clears the obsolete scene");
  cleanup();
  assert.equal(listeners.size, 0);
}

console.log("Hosted split-globals integration checks passed");
