import { expect, test } from "bun:test";
import { unzipSync } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { fakeViewer, realXyzViewer, science, waterScience, XYZ } from "./science-session-fixture";
import { ORIGINAL, importedDocument, options, exportArchive, restore, request, sceneDocument } from "./science-host-fixture";
import { recordImportedRevision, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { logicalSourceFor, sourceExtension, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { decodeScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { prepareSceneScienceExport } from "../apps/desktop/src/lib/science-session/export";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { writeBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
test("an imported output exports with its scene and restores into a fresh scene document, uuid and atom ids kept", async () => {
  const { document, text } = importedDocument();
  const bytes = await exportArchive(document, text);
  const first = (await decodeScienceSession(bytes))!;
  expect(first.source.text).toBe(text);
  expect(first.atomIds?.length).toBe(3);
  const { document: scene, outcome } = await restore(bytes, "/Scenes/water.molx", fakeViewer(text));
  expect(outcome).toBe("restored");
  expect(logicalSourceFor(scene.id)).toEqual({ documentId: scene.id, extension: "xyz", text });
  expect(sourceExtension({ id: scene.id, extension: "molx" })).toBe("xyz");
  const state = scientificStateFor(scene.id, text);
  expect(Array.from(state.revision!.document.grid!.values)).toEqual(Array.from(waterScience().grid!.values));
  expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(ORIGINAL);
  // Saved again from the restored scene: the same document and atoms.
  const again = (await decodeScienceSession(await exportArchive(scene, text)))!;
  expect(again.documentUuid).toBe(first.documentUuid);
  expect(again.atomIds).toEqual(first.atomIds);
  expect(Object.keys(unzipSync(bytes)).filter((name) => name.startsWith("assets/burette-science-")).length).toBe(1 + 5);
});

test("restore stops for a closed document, refuses a scene that is not the saved one, and leaves a foreign scene alone", async () => {
  const { document, text } = importedDocument();
  const bytes = await exportArchive(document, text);
  const closedEarly = await restore(bytes, "/C/early.molx", fakeViewer(text), () => false);
  expect(closedEarly.outcome).toBe("cancelled");
  expect(logicalSourceFor(closedEarly.document.id)).toBeNull();
  let checks = 0;
  const closing = await restore(bytes, "/C/late.molx", fakeViewer(text), () => ++checks < 3);
  expect(closing.outcome).toBe("cancelled");
  expect(logicalSourceFor(closing.document.id)).toBeNull();
  // Another structure ref in the scene than the one saved.
  const otherRefs = fakeViewer(text, { structure: "s2", model: "m", trajectory: "t" });
  await expect(restore(bytes, "/C/refs.molx", otherRefs)).rejects.toThrow(/does not match its scientific data/);
  const moved = fakeViewer(text);
  moved.move(text.replace("0.117300", "0.517300"));
  await expect(restore(bytes, "/C/moved.molx", moved)).rejects.toThrow(/does not show the current source/);
  expect(scientificStateFor("never", text).revision).toBeNull();
  const foreign = unzipSync(bytes);
  for (const name of Object.keys(foreign)) if (name.startsWith("assets/burette-science-")) delete foreign[name];
  const { zipSync } = await import("../apps/desktop/node_modules/fflate/esm/browser.js");
  const plain = await restore(zipSync(foreign), "/C/foreign.molx", fakeViewer(text));
  expect(plain.outcome).toBe("foreign");
  expect(logicalSourceFor(plain.document.id)).toBeNull();
});
