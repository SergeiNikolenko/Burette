import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { standaloneDemoScenes, standaloneDemoSnapshot } from "../apps/desktop/src/lib/web-demo-scenes.ts";

const root = new URL("../apps/burette-public-plugin/public/demo-scenes/", import.meta.url);
for (const scene of standaloneDemoScenes) {
  const source = await readFile(new URL(scene.asset, root));
  assert.ok(source.length > 0, scene.asset);
  const snapshot = standaloneDemoSnapshot(`/BuretteDemo/${scene.path}`);
  const files = [scene.asset, ...(snapshot ? [snapshot.split("/").pop()] : [])];
  for (const file of files.filter(file => file.endsWith(".molj"))) {
    const state = JSON.parse(await readFile(new URL(file, root), "utf8"));
    let structures = 0;
    async function inspect(value) {
      if (!value || typeof value !== "object") return;
      assert.notEqual(value.transformer, "ms-plugin.read-file", "Browser-only file assets cannot be replayed");
      if (value.transformer === "ms-plugin.download") {
        assert.ok(value.params.url.startsWith("/demo-scenes/"));
        assert.ok((await readFile(new URL(value.params.url.split("/").pop(), root))).length);
        structures++;
      }
      if (value.transformer === "ms-plugin.raw-data") structures++;
      for (const child of Object.values(value)) await inspect(child);
    }
    await inspect(state);
    assert.ok(structures > 0, `${file} must include portable structure data`);
  }
}
assert.equal(standaloneDemoSnapshot("/other/file.xyz"), undefined);
console.log("Curated demo scenes and portable snapshot assets passed.");
