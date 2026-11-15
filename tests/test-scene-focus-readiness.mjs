import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("apps/desktop/src/hooks/workspace-scene-import.ts", "utf8")
  .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(source);

for (const renderer of ["molstar", "xyzrender-external"]) {
  let requests = 0, delays = 0;
  const selected = [];
  const focus = new Function("activeViewerIframeForDocument", "requestViewerAction", "window",
    compiled + "\nreturn focusSceneDocument;")(
    () => ({ contentWindow: {} }),
    async (id, action, timeout) => {
      assert.equal(id, "incoming");
      assert.deepEqual(action, { type: "workspace_scene_state" });
      assert.equal(timeout, 1200);
      requests++;
      if (requests === 1) throw new Error("Frame exists before its message listener");
      return { ready: requests >= 3 };
    },
    { setTimeout: resolve => { delays++; resolve(); } },
  );
  await focus({ id: "incoming", renderer }, id => selected.push(id));
  assert.deepEqual({ selected, requests, delays }, {
    selected: ["incoming"], requests: 3, delays: 2,
  }, `${renderer} must acknowledge readiness before transfer can continue`);
}

let attempts = 0;
const unavailable = new Function("activeViewerIframeForDocument", "requestViewerAction", "window",
  compiled + "\nreturn focusSceneDocument;")(
  () => ({ contentWindow: {} }),
  async () => { attempts++; return { ready: false }; },
  { setTimeout: resolve => resolve() },
);
await assert.rejects(unavailable({ id: "incoming", renderer: "xyzrender-external" }, () => {}), /wait for its viewer/);
assert.equal(attempts, 50, "unready sheet must fail after bounded retries");
console.log("Scene focus readiness: passed");
