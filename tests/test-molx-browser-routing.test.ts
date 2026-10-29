import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { gzipSync, strToU8, zipSync } from "../apps/desktop/node_modules/fflate/esm/browser.js";
const browser = new Window({ url: "http://localhost/" }); Object.assign(browser, { setImmediate, clearImmediate }); Object.assign(globalThis, { window: browser, document: browser.document, localStorage: browser.localStorage });
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js"), { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { openBrowserDevDocuments } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const files = new Map<string, Uint8Array>();
globalThis.fetch = Object.assign(async (request: Parameters<typeof fetch>[0]) => {
  const url = new URL(String(request), "http://localhost");
  if (url.pathname === "/__burette/trajectory-pair") return new Response(null, { status: 404 });
  const path = url.searchParams.get("path") ?? decodeURIComponent(url.pathname.replace(/^\/@fs/u, ""));
  const bytes = files.get(path); if (!bytes) throw new Error(`Unexpected request: ${url.pathname}`);
  return new Response(Uint8Array.from(bytes).buffer, { headers: { "content-type": "application/octet-stream" } });
}, { preconnect: globalThis.fetch.preconnect });
async function open(path: string, bytes: Uint8Array) {
  files.set(path, bytes); const result = await openBrowserDevDocuments([path], { ...defaultPreferences, rendererMode: "molstar" } as any);
  expect(result.errors).toEqual([]); expect(result.documents).toHaveLength(1);
  const document = result.documents[0], config = JSON.parse(/window\.BuretteConfig\s*=\s*(\{[^\n]*?\});/u.exec(document.runtimePath)![1]);
  return { document, config };
}
test("an actual ordinary Molstar snapshot archive takes the structure viewer, while authored mesoscale retains its viewer", async () => {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  try {
    const raw = await plugin.builders.data.rawData({ data: "1\nordinary\nC 0 0 0\n" });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const archive = await plugin.managers.snapshot.serialize({ type: "molx", params: { image: false, camera: false } });
    const ordinary = await open("/Scenes/ordinary.molx", new Uint8Array(await archive.arrayBuffer()));
    expect([ordinary.document.extension, ordinary.config.format, ordinary.config.viewerProfile]).toEqual(["molx", "molx", "structure"]);
    const mesoscale = await open("/Scenes/cell.molx", zipSync({ "state.json": strToU8(JSON.stringify({ entries: [{ snapshot: { data: { tree: { transforms: [{ transformer: "ms-plugin.mesoscale-state" }] } } } }] })) }));
    expect(mesoscale.config.viewerProfile).toBe("mesoscale");
  } finally { plugin.dispose(); }
});
test("unreadable or absent state keeps the existing session fallback without inventing a usable structure", async () => {
  for (const [name, bytes] of [["broken", Uint8Array.of(1, 2, 3)], ["missing", zipSync({ "other.json": strToU8("{}") })], ["invalid", zipSync({ "state.json": strToU8("{broken") })]] as const) {
    const result = await open(`/Scenes/${name}.molx`, bytes); expect(result.config.viewerProfile).toBe("mesoscale");
  }
});
test("the selected routing hunk retains HEAD gzip structure decoding", async () => {
  const pdb = "ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C\nEND\n";
  const result = await open("/Structures/source.pdb.gz", gzipSync(strToU8(pdb)));
  expect([result.document.extension, result.config.format, result.config.viewerProfile]).toEqual(["pdb", "pdb", "structure"]);
  const payload = JSON.parse(/window\.BuretteDataBase64 = ("[^"\n]*");/u.exec(result.document.runtimePath)![1]);
  expect(Buffer.from(payload, "base64").toString("utf8")).toBe(pdb);
});
