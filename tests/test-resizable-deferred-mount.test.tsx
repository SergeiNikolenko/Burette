import { test, expect } from "bun:test";
import React, { act } from "react";
import { createResizableFixture } from "./resizable-panel-fixture";

let width = 1280;
let behavior: "preserve-pixel-size" | "preserve-relative-size" = "preserve-pixel-size";
const { size, createRoot, ref, Fixture, notify, expectPixels } =
  await createResizableFixture(() => width, () => behavior, { hiddenZero: true });

test("fresh deferred mount derives pixel defaults from current constraints before an imperative request", async () => {
  width = 0; behavior = "preserve-pixel-size";
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture bound={1000} />));
    width = 760;
    await act(async () => ref.current!.resize("360px")); expectPixels(360);
    await notify(); expectPixels(360);
    await act(async () => ref.current!.resize("500px")); expectPixels(500);
    width = 1280; await notify(); expectPixels(500);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
