import { expect, test } from "bun:test";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { encodeScienceSession, decodeScienceSession, SCIENCE_MANIFEST_ASSET_ID } from "../apps/desktop/src/lib/science-session/codec";
import { checkBindingReport } from "../apps/desktop/src/lib/science-session/scene-binding";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { waterScience, XYZ } from "./scientific-data-fixture";

const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 };
test("decoded ownership receipt hashes exact manifest bytes without persisting a runtime import token", async () => {
  const imported = { ...binding, importToken: crypto.randomUUID() };
  const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "xyz", text: XYZ },
    binding: imported, atomIds: ["o", "h1", "h2"], science: waterScience(), original: null });
  expect(encoded.manifest.binding).toEqual(binding);
  const assets = Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes]));
  const manifestPath = `assets/${SCIENCE_MANIFEST_ASSET_ID}`;
  const archive = () => zipSync({ "state.json": strToU8("{}"), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))), ...assets });
  const first = (await decodeScienceSession(archive()))!;
  expect(first.manifestSha256).toBe(await sha256Hex(assets[manifestPath]));
  assets[manifestPath] = strToU8(JSON.stringify(encoded.manifest, null, 2));
  const second = (await decodeScienceSession(archive()))!;
  expect(second.manifestSha256).not.toBe(first.manifestSha256);
  expect(second.science).toEqual(first.science);
});

test("binding reports retain validated ephemeral import authority and reject malformed tokens", () => {
  const report = { ...binding, ...readXyzFrames(XYZ)[0], importToken: crypto.randomUUID() };
  expect(checkBindingReport(report).importToken).toBe(report.importToken);
  for (const importToken of ["", "old-load", "x".repeat(1024), 3, null]) {
    expect(() => checkBindingReport({ ...report, importToken })).toThrow("invalid import identity");
  }
});
