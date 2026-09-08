#!/usr/bin/env bun
import assert from "node:assert/strict";
import { createMarkdownGreenfieldDocument } from "../apps/desktop/src/components/ui/markdown-greenfield-document.ts";
import { layoutMarkdownGreenfieldDocument } from "../apps/desktop/src/components/ui/markdown-greenfield-layout.ts";

// Both normal virtualized code and the large-block fallback must reserve the
// height of their viewport, not thousands of pixels for their source lines.
for (const lineCount of [180, 480]) {
  const source = ["# Report", "", "```json", "[",
    ...Array.from({ length: lineCount }, (_, index) => `  ${index},`),
    "  null", "]", "```", "", "## After JSON", "", "Finished.",
  ].join("\n");
  const document = createMarkdownGreenfieldDocument(source);
  for (const contentWidth of [356, 896]) {
    const frame = layoutMarkdownGreenfieldDocument({ document, contentWidth, fontScale: 1 });
    assert.ok(frame.totalHeight < 1500, `Unbounded initial height for ${lineCount} lines`);
    const codeChunk = document.chunks.find((chunk) => chunk.sourceText.startsWith("```json"));
    assert.ok(codeChunk);
    const measured = layoutMarkdownGreenfieldDocument({
      document, contentWidth, fontScale: 1,
      measuredHeights: { get: (chunk) => chunk.id === codeChunk.id ? 620 : undefined },
    });
    const codeFrame = measured.chunks.find((chunk) => chunk.id === codeChunk.id);
    const afterFrame = measured.chunks.find((chunk) => chunk.index === codeFrame.index + 1);
    assert.equal(codeFrame.height, 620);
    assert.equal(afterFrame.top, codeFrame.bottom);
    assert.ok(measured.totalHeight < 1500);
  }
}
console.log("Markdown block layout tests passed");
