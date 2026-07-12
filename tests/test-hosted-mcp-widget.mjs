#!/usr/bin/env bun
import assert from "node:assert/strict";

import {
  HOSTED_MCP_WIDGET_MESSAGE_SOURCE,
  createHostedMcpSelectionContext,
  isHostedMcpWidgetLocation,
  isHostedMcpToolResultMessage,
  parseHostedMcpStructureMessage,
  parseHostedMcpStructureResult,
  selectHostedMcpInitialStructure,
} from "../apps/desktop/src/lib/hosted-mcp-widget.ts";
import {
  deleteBrowserDevVirtualTextDocument,
  openBrowserDevMolstarContextDocument,
  readBrowserDevVirtualTextDocument,
} from "../apps/desktop/src/lib/browser-dev-documents.ts";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store.ts";

assert.equal(isHostedMcpWidgetLocation({ search: "?mcpWidget=1" }), true);
assert.equal(isHostedMcpWidgetLocation({ search: "?mcpWidget=0" }), false);

const structure = parseHostedMcpStructureMessage({
  source: HOSTED_MCP_WIDGET_MESSAGE_SOURCE,
  type: "tool-result",
  result: {
    structuredContent: { fileName: "example.cif" },
    _meta: {
      structure: {
        data: "data_example\n#\n",
        format: "cif",
      },
    },
  },
});
assert.equal(structure?.label, "example.cif");
assert.equal(structure?.format, "mmcif");
assert.equal(structure?.data, "data_example\n#\n");

const standardMessageStructure = parseHostedMcpStructureMessage({
  jsonrpc: "2.0",
  method: "ui/notifications/tool-result",
  params: {
    structuredContent: { fileName: "nested.sdf" },
    _meta: {
      mcp_tool_result: {
        result: {
          _meta: {
            structure: { data: "molecule\n$$$$\n", format: "sd" },
          },
        },
      },
    },
  },
});
assert.equal(standardMessageStructure?.label, "nested.sdf");
assert.equal(standardMessageStructure?.format, "sdf");
assert.equal(isHostedMcpToolResultMessage({
  jsonrpc: "2.0",
  method: "ui/notifications/tool-result",
  params: { isError: true },
}), true);
assert.equal(isHostedMcpToolResultMessage({
  jsonrpc: "2.0",
  method: "ui/notifications/tool-input",
}), false);

const contextDocument = await openBrowserDevMolstarContextDocument({
  label: "inline.pdb",
  entries: [{
    role: "structure",
    label: "inline.pdb",
    format: "pdb",
    data: "ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C\nEND\n",
  }],
}, defaultPreferences);
assert.equal(
  readBrowserDevVirtualTextDocument(contextDocument.path),
  "ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C\nEND\n",
);
deleteBrowserDevVirtualTextDocument(contextDocument.path);
assert.equal(readBrowserDevVirtualTextDocument(contextDocument.path), null);

const replacementDocument = await openBrowserDevMolstarContextDocument({
  label: "inline.pdb",
  entries: [{
    role: "structure",
    label: "inline.pdb",
    format: "pdb",
    data: "ATOM      1  N   MOL A   1       0.000   0.000   0.000  1.00  0.00           N\nEND\n",
  }],
}, defaultPreferences);
assert.notEqual(replacementDocument.path, contextDocument.path);
deleteBrowserDevVirtualTextDocument(replacementDocument.path);

const hostileLabel = "</script><script>globalThis.__burrete_xss_probe=1</script>.pdb";
const hostileDocument = await openBrowserDevMolstarContextDocument({
  label: hostileLabel,
  entries: [{
    role: "structure",
    label: hostileLabel,
    format: "pdb",
    data: "ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C\nEND\n",
  }],
}, defaultPreferences);
assert.equal(hostileDocument.runtimePath.includes(hostileLabel), false);
assert.equal(hostileDocument.runtimePath.includes("\\u003c/script>"), true);
deleteBrowserDevVirtualTextDocument(hostileDocument.path);

assert.equal(parseHostedMcpStructureMessage({
  source: HOSTED_MCP_WIDGET_MESSAGE_SOURCE,
  type: "tool-result",
  result: {
    _meta: { structure: { data: "unsafe", format: "html" } },
  },
}), null);

assert.equal(parseHostedMcpStructureResult({
  _meta: {
    structure: {
      data: "C".repeat(3 * 1024 * 1024 + 1),
      format: "pdb",
    },
  },
}), null);

assert.equal(parseHostedMcpStructureMessage({
  source: "untrusted",
  type: "tool-result",
  result: {
    _meta: { structure: { data: "ATOM", format: "pdb" } },
  },
}), null);

const initialStructure = selectHostedMcpInitialStructure([
  {
    structuredContent: { fileName: "older.pdb" },
    _meta: { structure: { data: "OLDER", format: "pdb" } },
  },
  {
    structuredContent: { fileName: "latest.pdb" },
    _meta: { structure: { data: "LATEST", format: "pdb" } },
  },
], {
  structuredContent: { fileName: "snapshot.pdb" },
  _meta: { structure: { data: "SNAPSHOT", format: "pdb" } },
});
assert.equal(initialStructure?.label, "latest.pdb");
assert.equal(initialStructure?.data, "LATEST");

const selectionContext = createHostedMcpSelectionContext({
  source: "lasso",
  label: "Lasso selection: 4 visible atoms across 2 residues",
  atoms: 4,
  residues: [
    { chain: "A", sequence: 12, compId: "CYS" },
    { chain: "A", sequence: 13, compId: "ARG" },
  ],
}, "document-1");
assert.equal(selectionContext?.structuredContent.burrete.activeSelection.atoms, 4);
assert.deepEqual(selectionContext?.structuredContent.burrete.activeSelection.residues, [
  { chain: "A", sequence: 12, compId: "CYS" },
  { chain: "A", sequence: 13, compId: "ARG" },
]);
assert.match(selectionContext?.content[0].text ?? "", /active molecular selection/);
assert.equal(createHostedMcpSelectionContext({ source: "click" }, "document-1"), null);

console.log("Hosted MCP widget contract tests passed");
