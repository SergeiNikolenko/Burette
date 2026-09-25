import { expect, test } from "bun:test";

import { annotationContext, type Annotation } from "../apps/desktop/src/lib/annotation-region";

const rect = { left: 0, top: 0, width: 10, height: 10 };
const pin = { x: 10, y: 0 };

test("annotation batch is one composer card that names picked atoms and drops layout boxes", () => {
  const annotations: Annotation[] = [
    { id: 1, rect, pin, comment: "Why is this oxygen charged?", target: {
      surface: "molstar", atomCount: 1, residues: [{ chain: "A", sequence: 1, compId: "MOL" }],
      atomIdentities: [{ chain: "A", sequence: 1, compId: "MOL", atomName: "O", atomIndex: 0 }],
    } },
    { id: 2, rect, pin, comment: "Deuterate this hydrogen", target: {
      surface: "xyzrender", structures: [{ label: "mini.xyz", atomCount: 1, atoms: "3" }], box: rect,
    } },
    { id: 3, rect, pin, comment: "Make this a pyridine", target: { surface: "grid", rowCount: 1, sourceIndexes: [1], box: rect } },
  ];
  const context = annotationContext("mini.xyz", annotations);
  expect(context.content).toEqual([{ type: "text", text: [
    "Burette annotations on mini.xyz:",
    "",
    "1. Why is this oxygen charged?\n   → Mol*: A:MOL1 O (atom index 0).",
    "2. Deuterate this hydrogen\n   → xyzrender: mini.xyz atom 3 (1-based).",
    "3. Make this a pyridine\n   → Grid: 1 row, source indexes (zero-based) 1.",
  ].join("\n") }]);
  expect(context.presentation).toEqual({ composerAttachmentLayout: "card", composerLabel: "Burette · 3 annotations · mini.xyz" });
  expect(JSON.stringify(context.structuredContent)).not.toContain('"box"');
});
