import assert from "node:assert/strict";

import { statusErrorMessage } from "../apps/desktop/src/hooks/use-app-status.ts";

assert.equal(statusErrorMessage(new Error("plain error")), "plain error");
assert.equal(statusErrorMessage("string error"), "string error");
assert.equal(
  statusErrorMessage({ code: "GPU_UNAVAILABLE", message: "Metal device is unavailable", currentRevision: null }),
  "Metal device is unavailable",
);
assert.equal(
  statusErrorMessage({ error: { message: "Nested native error" } }),
  "Nested native error",
);
assert.equal(statusErrorMessage({ code: "UNKNOWN" }), '{"code":"UNKNOWN"}');

console.log("status error message tests passed");
