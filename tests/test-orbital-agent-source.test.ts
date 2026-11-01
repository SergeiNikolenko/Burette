import { expect, test } from "bun:test";
import { createAgentSourceOwner } from "../apps/desktop/src/lib/workbench/agent-source";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { addDocumentInternalCoordinates, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { quantumCalculationInput } from "../apps/desktop/src/lib/molecular-workbench/quantum-client";
import type { ViewerDocument } from "../apps/desktop/src/types";

test("real reader and source owner bind immutable full source data while the quantum projection excludes unrelated payload", async () => {
  let text = `[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1 1\n[MO]\nSym= A\nEne= -0.5\nSpin= Alpha\nOccup= 1\n1 1\n`;
  const doc: ViewerDocument = { id: "source-owner", path: "/h.molden", title: "h.molden", extension: "molden", renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  const owner = createAgentSourceOwner({ runtime: "browser-agent-shell", draftsVisible: true, documents: () => [doc], activeDocument: () => doc,
    readSource: async () => ({ text, origin: "draft" }) }, new AbortController().signal);
  try {
    const parsed = await owner.snapshotOf({});
    expect([parsed.scientificOrigin, parsed.scientific?.atoms.length]).toEqual(["parsed", 1]);
    const science = parseScientificFile("h.molden", text);
    const projectionOnly = { ...science };
    Object.defineProperties(projectionOnly, { grid: { get() { throw new Error("unrelated grid read"); } }, modes: { get() { throw new Error("unrelated modes read"); } } });
    expect(quantumCalculationInput(projectionOnly).modes).toEqual([]);
    addDocumentInternalCoordinates(doc.id, text, science);
    expect((await owner.snapshotOf({})).revision).toBe(parsed.revision);
    science.basis![0].exponents[0] = 2;
    const changed = await owner.snapshotOf({}); expect(changed.revision).not.toBe(parsed.revision);
    expect(parsed.scientific?.basis?.[0].exponents).toEqual([1]);
    await expect(owner.snapshotOf({ expectedSourceRevision: parsed.revision })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const replacement = parseScientificFile("h.molden", text); replacement.atoms[0].x = 1;
    addDocumentInternalCoordinates(doc.id, text, replacement);
    expect((await owner.snapshotOf({})).revision).not.toBe(changed.revision);
    text = " ".repeat(12 * 1024 * 1024 + 1);
    await expect(owner.snapshotOf({})).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  } finally { owner.dispose(); releaseClosedImports(new Set()); }
});
