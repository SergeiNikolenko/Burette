import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: browser,
  self: browser,
  document: browser.document,
  navigator: browser.navigator,
  HTMLElement: browser.HTMLElement,
  Element: browser.Element,
  Node: browser.Node,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  HTMLFormElement: browser.HTMLFormElement,
  DocumentFragment: browser.DocumentFragment,
  NodeFilter: browser.NodeFilter,
  SVGElement: browser.SVGElement,
  CustomEvent: browser.CustomEvent,
  Event: browser.Event,
  FocusEvent: browser.FocusEvent,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent,
  MutationObserver: browser.MutationObserver,
  CSS: browser.CSS,
  localStorage: browser.localStorage,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [name, value] of previous) {
    if (value) Object.defineProperty(globalThis, name, value);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const readStructureTextMock = mock<(...args: unknown[]) => Promise<string>>(async () => "");
const runChemistryTaskMock = mock<(...args: unknown[]) => Promise<{ molfile: string; atoms: unknown[] }>>(async () => ({ molfile: "", atoms: [] }));
const runReaderTaskMock = mock<(...args: unknown[]) => Promise<unknown>>(async () => ({ atoms: [], frames: [] }));

mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: (...args: unknown[]) => readStructureTextMock(...args),
}));

mock.module("../apps/desktop/src/lib/molecular-workbench/compute-client", () => ({
  runChemistryTask: (...args: unknown[]) => runChemistryTaskMock(...args),
}));

mock.module("../apps/desktop/src/lib/workbench/reader-task", () => ({
  runReaderTask: (...args: unknown[]) => runReaderTaskMock(...args),
}));

const { createRoot } = await import("react-dom/client");
const {
  canEditIn3d,
  edit3dMode,
  extractSdfRecord,
  extractSelectedMmcifAtoms,
  extractSelectedPdbAtoms,
  openEdit3d,
  parseMol2ToSdf,
} = await import("../apps/desktop/src/lib/workbench/edit-3d");
const { structureEditAvailable } = await import("../apps/desktop/src/lib/workbench/graph-draft");
const { molstarToolMenuItems } = await import("../apps/desktop/src/components/molstar-tool-menu");
const { StructureEditToolRow } = await import("../apps/desktop/src/components/workbench/structure-edit-entrypoint");
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";

const SINGLE_SDF = [
  "water",
  "  Burette           3D",
  "",
  "  3  2  0  0  0  0  0  0  0  0999 V2000",
  "    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.7570    0.5860    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -0.7570    0.5860    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0",
  "  1  3  1  0  0  0  0",
  "M  END",
  "$$$$",
  "",
].join("\n");

const SINGLE_XYZ = [
  "3",
  "water",
  "O 0.0 0.0 0.0",
  "H 0.757 0.586 0.0",
  "H -0.757 0.586 0.0",
  "",
].join("\n");

const SAMPLE_MOL2 = [
  "@<TRIPOS>MOLECULE",
  "benzene-frag",
  "3 2 0 0 0",
  "SMALL",
  "NO_CHARGES",
  "@<TRIPOS>ATOM",
  "1 C1 0.0000 0.0000 0.0000 C.ar 1 UNL 0.0",
  "2 C2 1.3900 0.0000 0.0000 C.ar 1 UNL 0.0",
  "3 O1 2.1000 1.2000 0.0000 O.2  1 UNL 0.0",
  "@<TRIPOS>BOND",
  "1 1 2 ar",
  "2 2 3 2",
  "",
].join("\n");

const SAMPLE_PDB = [
  "ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 20.00           C",
  "HETATM    2  C1  LIG B 301      10.000  11.000  12.000  1.00 10.00           C",
  "HETATM    3  O1  LIG B 301      11.200  11.000  12.000  1.00 10.00           O",
  "END",
].join("\n");

const SAMPLE_MMCIF = [
  "data_test",
  "loop_",
  "_atom_site.group_PDB",
  "_atom_site.type_symbol",
  "_atom_site.label_comp_id",
  "_atom_site.auth_asym_id",
  "_atom_site.auth_seq_id",
  "_atom_site.Cartn_x",
  "_atom_site.Cartn_y",
  "_atom_site.Cartn_z",
  "ATOM C ALA A 1 1.0 2.0 3.0",
  "HETATM C LIG B 301 10.0 11.0 12.0",
  "HETATM O LIG B 301 11.2 11.0 12.0",
].join("\n");

function doc(overrides: Partial<ViewerDocument>): ViewerDocument {
  return {
    id: overrides.id ?? "doc-1",
    path: overrides.path ?? "/tmp/sample.pdb",
    title: overrides.title ?? "sample.pdb",
    extension: overrides.extension ?? "pdb",
    renderer: overrides.renderer ?? "molstar",
    runtimePath: overrides.runtimePath ?? "/tmp/runtime/index.html",
    byteCount: overrides.byteCount ?? 128,
    ...overrides,
  };
}

function makeActions() {
  const openDockTab = mock(() => {});
  const setDockDocument = mock(() => {});
  const openStructureRecords = mock(async (records: Array<{ path: string; inputExtension: string; text: string }>) => [
    doc({
      id: "virtual-copy-1",
      path: `/tmp/virtual/${records[0].path}`,
      title: records[0].path,
      extension: records[0].inputExtension,
      virtual: true,
    }),
  ]);
  return { openDockTab, setDockDocument, openStructureRecords };
}

afterEach(() => {
  readStructureTextMock.mockReset();
  runChemistryTaskMock.mockReset();
  runReaderTaskMock.mockReset();
});

describe("3D edit eligibility and format conversion", () => {
  test("classifies editable formats across SDF, XYZ, PDB, CIF, MOL2, and unsupported views", () => {
    expect(edit3dMode(doc({ extension: "sdf", path: "/tmp/a.sdf" }))).toBe("in-place-graph");
    expect(edit3dMode(doc({ extension: "mol", path: "/tmp/a.mol" }))).toBe("in-place-graph");
    expect(edit3dMode(doc({ extension: "xyz", path: "/tmp/a.xyz" }))).toBe("in-place-geometry");
    expect(edit3dMode(doc({ extension: "pdb", path: "/tmp/a.pdb" }))).toBe("convert-to-sdf");
    expect(edit3dMode(doc({ extension: "cif", path: "/tmp/a.cif" }))).toBe("convert-to-sdf");
    expect(edit3dMode(doc({ extension: "mmcif", path: "/tmp/a.mmcif" }))).toBe("convert-to-sdf");
    expect(edit3dMode(doc({ extension: "mol2", path: "/tmp/a.mol2" }))).toBe("convert-to-sdf");
    expect(canEditIn3d(doc({ extension: "sdf", renderer: "grid2d" }))).toBe(false);
    expect(canEditIn3d(doc({ extension: "pdb", mergedCollection: { sourcePaths: [], format: "pdb", suggestedFileName: "m.pdb" } }))).toBe(false);
  });

  test("parses MOL2 coordinates and explicit bond orders into an SDF record", () => {
    const sdf = parseMol2ToSdf(SAMPLE_MOL2);
    expect(sdf).toContain("benzene-frag");
    expect(sdf).toContain("  3  2  0");
    expect(sdf).toContain("  1  2  4  0  0  0  0");
    expect(sdf).toContain("  2  3  2  0  0  0  0");
    expect(sdf.trimEnd().endsWith("$$$$")).toBe(true);
  });

  test("extracts the requested record from a multi-record SDF", () => {
    const multi = `${SINGLE_SDF}${SINGLE_SDF.replace("water", "second-mol")}`;
    expect(extractSdfRecord(multi, 0)).toContain("water");
    expect(extractSdfRecord(multi, 1)).toContain("second-mol");
    expect(extractSdfRecord(multi, 99)).toContain("second-mol");
  });

  test("extracts selected ligand atoms from PDB and mmCIF files", () => {
    const selector = { kind: "ligand", label_comp_id: "LIG", auth_asym_id: "B", auth_seq_id: 301 };
    expect(extractSelectedPdbAtoms(SAMPLE_PDB, selector)).toEqual([
      { element: "C", x: 10, y: 11, z: 12 },
      { element: "O", x: 11.2, y: 11, z: 12 },
    ]);
    expect(extractSelectedMmcifAtoms(SAMPLE_MMCIF, selector)).toEqual([
      { element: "C", x: 10, y: 11, z: 12 },
      { element: "O", x: 11.2, y: 11, z: 12 },
    ]);
  });

  test("opens single SDF and XYZ in-place, and converts multi-record SDF, MOL2, and PDB ligands into editable 3D copies", async () => {
    const actions = makeActions();

    readStructureTextMock.mockResolvedValueOnce(SINGLE_SDF);
    const sdfResult = await openEdit3d(doc({ id: "s1", extension: "sdf", path: "/tmp/a.sdf", title: "a.sdf" }), actions);
    expect(sdfResult.openedCopy).toBe(false);
    expect(actions.openDockTab).toHaveBeenCalledWith("right", "structure-edit");

    readStructureTextMock.mockResolvedValueOnce(SINGLE_XYZ);
    const xyzResult = await openEdit3d(doc({ id: "x1", extension: "xyz", path: "/tmp/a.xyz", title: "a.xyz" }), actions);
    expect(xyzResult.openedCopy).toBe(false);
    expect(actions.openDockTab).toHaveBeenCalledWith("right", "geometry");

    const multiSdf = `${SINGLE_SDF}${SINGLE_SDF.replace("water", "pose-2")}`;
    readStructureTextMock.mockResolvedValueOnce(multiSdf);
    runChemistryTaskMock.mockResolvedValueOnce({ molfile: SINGLE_SDF.replace("$$$$\n", ""), atoms: [] });
    const multiResult = await openEdit3d(
      doc({ id: "m1", extension: "sdf", path: "/tmp/poses.sdf", title: "poses.sdf" }),
      actions,
      { frameIndex: 1 },
    );
    expect(multiResult.openedCopy).toBe(true);
    expect(structureEditAvailable(multiResult.document)).toBe(true);

    readStructureTextMock.mockResolvedValueOnce(SAMPLE_MOL2);
    runChemistryTaskMock.mockResolvedValueOnce({ molfile: SINGLE_SDF.replace("$$$$\n", ""), atoms: [] });
    const mol2Result = await openEdit3d(doc({ id: "m2", extension: "mol2", path: "/tmp/lig.mol2", title: "lig.mol2" }), actions);
    expect(mol2Result.openedCopy).toBe(true);

    readStructureTextMock.mockResolvedValueOnce(SAMPLE_PDB);
    runChemistryTaskMock.mockResolvedValueOnce({ molfile: SINGLE_SDF.replace("$$$$\n", ""), atoms: [] });
    const pdbResult = await openEdit3d(
      doc({ id: "p1", extension: "pdb", path: "/tmp/complex.pdb", title: "complex.pdb" }),
      actions,
      { ligand: { label: "LIG B:301", selector: { label_comp_id: "LIG", auth_asym_id: "B", auth_seq_id: 301 } } },
    );
    expect(pdbResult.openedCopy).toBe(true);
    expect(structureEditAvailable(pdbResult.document)).toBe(true);
    expect(actions.setDockDocument).toHaveBeenCalledWith("right", "virtual-copy-1");
    expect(actions.openDockTab).toHaveBeenCalledWith("right", "structure-edit");
  });

  test("gives an actionable error when a PDB exceeds the 256-atom editing limit without a selected ligand", async () => {
    const actions = makeActions();
    const bigPdb = Array.from({ length: 300 }, (_, i) =>
      `ATOM  ${String(i + 1).padStart(5)}  CA  ALA A${String(i + 1).padStart(4)}       1.000   2.000   3.000  1.00 20.00           C`,
    ).join("\n");
    readStructureTextMock.mockResolvedValueOnce(bigPdb);
    await expect(openEdit3d(doc({ extension: "pdb", path: "/tmp/protein.pdb", title: "protein.pdb" }), actions))
      .rejects.toThrow(/Select a ligand/u);
  });
});

describe("3D edit UI entry points", () => {
  test("adds Edit in 3D to the Mol* context menu for PDB/CIF/MOL2 and atom editing for XYZ", () => {
    const openDockTab = mock(() => {});
    const pdbItems = molstarToolMenuItems(doc({ extension: "pdb" }), null, openDockTab);
    expect(pdbItems.some((item) => item.kind === "item" && item.text === "Edit in 3D…")).toBe(true);

    const xyzItems = molstarToolMenuItems(doc({ extension: "xyz", path: "/tmp/a.xyz" }), 0, openDockTab);
    expect(xyzItems.some((item) => item.kind === "item" && item.text === "Edit geometry")).toBe(true);
    expect(xyzItems.some((item) => item.kind === "item" && item.text === "Edit atoms and bonds…")).toBe(true);
  });

  test("renders StructureEditToolRow inside Info for PDB with ligand scope and launches 3D editing on click", async () => {
    const actions = makeActions();
    readStructureTextMock.mockResolvedValueOnce(SAMPLE_PDB);
    runChemistryTaskMock.mockResolvedValueOnce({ molfile: SINGLE_SDF.replace("$$$$\n", ""), atoms: [] });
    const targetDoc = doc({ id: "pdb-doc", extension: "pdb", path: "/tmp/complex.pdb", title: "complex.pdb" });

    const host = globalThis.document.createElement("div");
    globalThis.document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <StructureEditToolRow
            document={targetDoc}
            viewerLigandSelection={{
              documentId: "pdb-doc",
              label: "LIG B:301",
              atoms: 2,
              selector: { label_comp_id: "LIG", auth_asym_id: "B", auth_seq_id: 301 },
            }}
            actions={actions as unknown as ShellActions}
          />,
        );
      });

      expect(host.textContent).toContain("Edit in 3D");
      expect(host.textContent).toContain("LIG B:301 · opens 3D copy");
      const btn = host.querySelector<HTMLButtonElement>('button[aria-label="Edit in 3D"]');
      expect(btn).toBeTruthy();
      await act(async () => {
        btn!.click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(actions.openDockTab).toHaveBeenCalledWith("right", "structure-edit");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
