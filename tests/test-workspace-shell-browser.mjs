// Run on the browser-dev host with a Playwright installation and a fresh shell URL.
// BURETTE_BROWSER_URL seeds mini.pdb and mini.cif through devFiles.
// Start the IPv6 loopback shell with:
// BURETTE_AGENT_SHELL_FORCE_VP=1 bun scripts/burette-agent.mjs open --mode browser-agent-shell --host ::1 samples/mini.pdb
// Use the returned result.url and stop result.processId when finished.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { BURETTE_BROWSER_URL, BURETTE_BROWSER_ARTIFACTS, PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE } = process.env;
assert.ok(BURETTE_BROWSER_URL, "BURETTE_BROWSER_URL must point to the browser-dev shell");
assert.ok(BURETTE_BROWSER_ARTIFACTS, "BURETTE_BROWSER_ARTIFACTS must point to an output directory");
const { chromium } = await import(PLAYWRIGHT_MODULE ? pathToFileURL(PLAYWRIGHT_MODULE).href : "playwright");
const url = new URL(BURETTE_BROWSER_URL);
url.searchParams.set("devFiles", "samples/mini.pdb\nsamples/mini.cif");
const browser = await chromium.launch({
  executablePath: CHROMIUM_EXECUTABLE,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const matrix = [
  { colorScheme: "dark", width: 1007, reducedMotion: "no-preference" },
  { colorScheme: "light", width: 925, reducedMotion: "no-preference" },
  { colorScheme: "dark", width: 925, reducedMotion: "reduce" },
  { colorScheme: "light", width: 1007, reducedMotion: "reduce" },
];
const results = [];

function button(parent, name) {
  return parent.getByRole("button", { name, exact: true });
}
function tab(parent, name) {
  return parent.getByRole("tab", { name, exact: true });
}
async function menu(page, name) {
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function selected(group, name) {
  await group.getByRole("tab", { name, exact: true, selected: true }).waitFor();
}

async function drag(page, source, destination, offset = 0) {
  const start = await source.boundingBox();
  const end = await destination.boundingBox();
  assert.ok(start && end, "Both drag surfaces are visible");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2 + offset, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function camera(iframe) {
  return iframe.evaluate(frame => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      removeEventListener("message", receive);
      reject(new Error("Viewer camera request timed out"));
    }, 5000);
    function receive(event) {
      if (event.source !== frame.contentWindow || event.data?.body?.requestId !== requestId) return;
      clearTimeout(timeout);
      removeEventListener("message", receive);
      resolve(event.data.body.viewState.camera);
    }
    addEventListener("message", receive);
    frame.contentWindow.postMessage({ source: "burette-host", body: { type: "captureRendererViewState", requestId } }, "*");
  }));
}

async function monitorCanvas(iframe) {
  await iframe.evaluate(frame => {
    const view = frame.contentWindow;
    const canvas = frame.contentDocument.querySelector("canvas");
    const surface = canvas.parentElement;
    const samples = [];
    // A new task after rAF lets resize observers run before geometry is read.
    const channel = new view.MessageChannel();
    const sampleAfterPaint = () => { channel.port2.postMessage(view.performance.now()); };
    let handle = view.requestAnimationFrame(sampleAfterPaint);
    const stop = () => {
      view.cancelAnimationFrame(handle);
      channel.port1.close();
      channel.port2.close();
    };
    channel.port1.onmessage = ({ data: now }) => {
      const viewport = surface.getBoundingClientRect();
      const rect = canvas.getBoundingClientRect();
      if (viewport.width > 1 && viewport.height > 1) {
        samples.push({ now, viewport: [viewport.width, viewport.height],
          canvas: [rect.x - viewport.x, rect.y - viewport.y, rect.width, rect.height] });
      }
      if (samples.length >= 80) stop();
      else handle = view.requestAnimationFrame(sampleAfterPaint);
    };
    view.__workspaceCanvasMonitor = { samples, stop };
  });
}

async function canvasFits(iframe) {
  await iframe.contentFrame().locator("canvas").first().waitFor();
  const handle = await iframe.elementHandle();
  await iframe.page().waitForFunction(frame => {
    const canvas = frame.contentDocument?.querySelector("canvas");
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const parent = canvas.parentElement.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && Math.abs(rect.x - parent.x) < 2
      && Math.abs(rect.y - parent.y) < 2 && Math.abs(rect.width - parent.width) < 2
      && Math.abs(rect.height - parent.height) < 2;
  }, handle);
  await handle.dispose();
}

async function assertFullViewChrome(page, iframe, compute) {
  const exit = await button(page, "Exit Full View").boundingBox();
  const viewer = await iframe.boundingBox();
  const sequenceMode = iframe.contentFrame().locator('.buret-seq-header [data-role="View"] button');
  await sequenceMode.waitFor();
  const chain = await sequenceMode.boundingBox();
  const action = await compute.boundingBox();
  assert.ok(exit && viewer && chain && action, "Full View, Sequence and Compute controls are visible");
  assert.ok(exit.y + exit.height <= viewer.y + 1, "Exit Full View stays outside the viewer");
  assert.ok(exit.y + exit.height <= chain.y, "Exit Full View does not overlap the Chain control");
  assert.ok(action.x > viewer.x + viewer.width / 2 && action.x + action.width <= viewer.x + viewer.width + 1,
    "Compute stays in the right portion of the molecular viewer");
  assert.ok(action.y < viewer.y + viewer.height / 2, "Compute stays above the viewport midpoint");
  const chrome = iframe.contentFrame().getByRole("toolbar", { name: "Burette preview controls", exact: true });
  const rail = iframe.contentFrame().getByRole("toolbar", { name: "Viewport controls", exact: true });
  for (const control of [chrome, rail, sequenceMode]) {
    const bounds = await control.boundingBox();
    if (!bounds) continue;
    assert.ok(action.x + action.width <= bounds.x + 1 || bounds.x + bounds.width <= action.x + 1
      || action.y + action.height <= bounds.y + 1 || bounds.y + bounds.height <= action.y + 1,
    "Compute does not intersect the sequence or viewer controls");
  }
}

async function checkWorkspace(page, evidence, row) {
  await page.goto(url.href);
  const skip = button(page, "Skip introduction");
  await Promise.race([skip.waitFor(), tab(page, "mini.pdb").waitFor()]);
  if (await skip.isVisible()) await skip.click();

  const main = page.getByRole("tablist", { name: "Workspace tabs", exact: true });
  const right = page.getByRole("tablist", { name: "right tabs", exact: true });
  const rightHeader = page.locator(".workspace-group-header").filter({ has: right });
  const toggle = button(page, "Toggle right panel");
  const resize = page.getByRole("separator", { name: "Resize right split", exact: true });
  const mainPlus = button(page.locator(".topbar"), "New tab");
  const rightPlus = button(rightHeader, "New tab");
  const source = "mini.pdb";
  const second = "mini.cif";

  await tab(main, source).click();
  await selected(main, source);
  assert.equal(await page.locator(".app-shell").getAttribute("data-effective-theme"), row.colorScheme);
  const sourceId = await tab(main, source).evaluate(element => element.closest("[data-tab-id]").dataset.tabId);
  const sourceSurface = page.locator(`.page-surface[data-view-id=${JSON.stringify(sourceId)}]`);
  const sourceFrame = sourceSurface.locator("iframe.viewer-iframe:visible");
  const compute = button(sourceSurface, "Open molecular compute menu");
  await compute.waitFor();
  await canvasFits(sourceFrame);
  await sourceFrame.evaluate(frame => { frame.contentWindow.__workspaceBrowserIdentity = true; });
  const originalCamera = await camera(sourceFrame);
  assert.ok(originalCamera?.position, "The live molecule has a camera");
  const canvas = sourceFrame.contentFrame().locator("canvas").first();
  const box = await canvas.boundingBox();
  assert.ok(box, "Molecular canvas is visible");
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.46);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.61, box.y + box.height * 0.53, { steps: 12 });
  await page.mouse.up();
  let rotatedCamera = originalCamera;
  for (let attempt = 0, stableFrames = 0; attempt < 60 && stableFrames < 3; attempt++) {
    await sourceFrame.evaluate(frame => new Promise(resolve => frame.contentWindow.requestAnimationFrame(resolve)));
    const current = await camera(sourceFrame);
    const unchanged = current.position.every((value, i) => Math.abs(value - rotatedCamera.position[i]) < 0.001);
    stableFrames = unchanged ? stableFrames + 1 : 0;
    rotatedCamera = current;
  }
  assert.ok(rotatedCamera.position.some((value, i) => Math.abs(value - originalCamera.position[i]) > 0.01),
    "Real pointer drag rotates the molecule");

  if (url.hostname === "[::1]") await page.evaluate(() => {
    const location = new URL(window.location.href);
    location.searchParams.delete("devFiles");
    location.searchParams.delete("agentLayout");
    history.replaceState(null, "", location);
  });

  await mainPlus.click();
  await menu(page, "Files");
  await selected(main, "Files");
  assert.equal(await tab(main, source).count(), 1, "Opening Files does not move the molecule");
  await tab(main, source).click();
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  await selected(right, "Info");
  const info = name => page.locator('.page-surface[data-pane="right"][data-workspace-visible]')
    .getByRole("heading", { name, exact: true });
  await info(source).waitFor();
  await tab(main, second).click();
  await info(second).waitFor();
  await tab(main, source).click();
  await info(source).waitFor();
  assert.equal(await right.count(), 1, "There is one right tablist");
  assert.equal(await resize.count(), 1, "There is one right resize boundary");
  assert.equal(await page.locator('.dock-file-tabs[aria-label="right dock files"]:visible').count(), 0, "There is no independent right dock");

  await rightPlus.click();
  await menu(page, "Files");
  await selected(right, "Files");
  assert.equal(await tab(main, source).count(), 1, "Right Files does not move the molecule");
  assert.equal(await tab(main, "Files").count(), 1, "Right + opens its own group");
  await tab(right, "Info").hover();
  await button(rightHeader, "Close Info tab").click();

  const initialSplit = Number(await resize.getAttribute("aria-valuenow"));
  await resize.press("ArrowRight");
  assert.equal(Number(await resize.getAttribute("aria-valuenow")), initialSplit + 5, "Keyboard resize changes the shared split");
  await drag(page, resize, resize, -38);
  const resizedSplit = Number(await resize.getAttribute("aria-valuenow"));
  assert.ok(resizedSplit < initialSplit + 5, "Pointer drag also resizes the shared split");

  await tab(main, source).click();
  await rightPlus.click();
  await menu(page, "Info");
  await selected(right, `Info · ${source}`);
  await info(source).waitFor();
  await tab(main, second).click();
  await info(source).waitFor();
  assert.equal(await info(second).count(), 0, "Explicit Info remains pinned to its original source");
  await tab(main, source).click();
  await button(rightHeader, `Close Info · ${source} tab`).click();
  await selected(right, "Files");

  await drag(page, tab(main, source), tab(right, "Files"));
  await selected(right, source);
  assert.equal(await tab(main, source).count(), 0, "Pointer DnD moves the document out of main");
  await canvasFits(sourceFrame);
  assert.equal(await sourceFrame.evaluate(frame => frame.contentWindow.__workspaceBrowserIdentity), true,
    "Pointer DnD retains the original iframe runtime");
  await page.screenshot({ path: evidence("right-molecule.png") });

  await toggle.click();
  await right.waitFor({ state: "hidden" });
  await resize.waitFor({ state: "hidden" });
  await toggle.click();
  await selected(right, source);
  assert.equal(await sourceFrame.evaluate(frame => frame.contentWindow.__workspaceBrowserIdentity), true,
    "Right group hide and reveal retain the renderer");

  await canvasFits(sourceFrame);
  await monitorCanvas(sourceFrame);
  await button(rightHeader, "Enter Full View").click();
  await button(page, "Exit Full View").waitFor();
  await rightHeader.waitFor({ state: "hidden" });
  await resize.waitFor({ state: "hidden" });
  await selected(page.locator(".topbar"), source);
  await canvasFits(sourceFrame);
  await sourceFrame.evaluate(frame => new Promise(resolve => {
    const view = frame.contentWindow;
    let remaining = 8;
    function sample() { if (--remaining) view.requestAnimationFrame(sample); else resolve(); }
    view.requestAnimationFrame(sample);
  }));
  const frames = await sourceFrame.evaluate(frame => {
    const monitor = frame.contentWindow.__workspaceCanvasMonitor;
    monitor.stop();
    return monitor.samples;
  });
  assert.ok(new Set(frames.map(frame => frame.viewport[0])).size > 1, "Sampled geometry before and after Full View");
  row.fullViewFrames = frames;
  // Compare the composited canvas to its owning stage, not to the drawing buffer.
  const clippedFrames = frames.filter(({ viewport: [width, height], canvas: [x, y, w, h] }) =>
    Math.max(Math.abs(x), Math.abs(y), Math.abs(width - w), Math.abs(height - h)) > 2);
  assert.deepEqual(clippedFrames, [], "Canvas remains flush during Full View transition");

  await button(sourceFrame.contentFrame(), "Toggle sequence panel").click();
  await canvasFits(sourceFrame);
  await assertFullViewChrome(page, sourceFrame, compute);
  await page.screenshot({ path: evidence("full-sequence.png") });
  await compute.click();
  await page.getByRole("menu").waitFor();
  await page.keyboard.press("Escape");

  await button(page, "Exit Full View").click();
  await selected(right, source);
  assert.equal(Number(await resize.getAttribute("aria-valuenow")), resizedSplit);
  await button(sourceFrame.contentFrame(), "Toggle sequence panel").click();
  await drag(page, tab(right, source), tab(main, second));
  await selected(main, source);
  assert.equal(await tab(right, source).count(), 0, "Pointer DnD moves the document back to main");
  await canvasFits(sourceFrame);
  assert.equal(await sourceFrame.evaluate(frame => frame.contentWindow.__workspaceBrowserIdentity), true,
    "Moves and Full View retain the original renderer");
  const finalCamera = await camera(sourceFrame);
  row.camera = { original: originalCamera, rotated: rotatedCamera, restored: finalCamera };
  for (const key of ["position", "target", "up"]) {
    assert.ok(finalCamera[key].every((value, i) => Math.abs(value - rotatedCamera[key][i]) < 0.01),
      `Camera ${key} is preserved after movement and resize`);
  }
  await page.screenshot({ path: evidence("right-files.png") });

  const mainOrder = () => main.getByRole("tab").evaluateAll(tabs => tabs.map(element => element.ariaLabel));
  const before = await mainOrder();
  const sourceWasFirst = before.indexOf(source) < before.indexOf(second);
  await drag(page, tab(main, source), tab(main, second), sourceWasFirst ? 14 : -14);
  const after = await mainOrder();
  assert.equal(after.indexOf(source) < after.indexOf(second), !sourceWasFirst, "Pointer DnD reorders within the same group");
  assert.equal(await sourceFrame.evaluate(frame => frame.contentWindow.__workspaceBrowserIdentity), true,
    "Reordering does not reload the molecular iframe");

  if (url.hostname === "[::1]") {
    const hideBeforeReload = row.reducedMotion === "reduce";
    if (hideBeforeReload) {
      await toggle.click();
      await right.waitFor({ state: "hidden" });
    }
    await page.reload();
    // Browser-dev restores the tab shell. Loading the persisted document
    // contents is owned by the native and embedded MCP startup paths.
    await main.locator(`[data-tab-id=${JSON.stringify(sourceId)}] [role="tab"][aria-selected="true"]`).waitFor();
    assert.equal(await toggle.getAttribute("aria-pressed"), String(!hideBeforeReload), "Right group visibility survives reload");
    if (hideBeforeReload) await toggle.click();
    await selected(right, "Files");
    assert.equal(Number(await resize.getAttribute("aria-valuenow")), resizedSplit);
    row.reload = "tab identity, selection, visibility and split width restored";
  } else {
    row.reload = "requires an IPv6 loopback URL";
  }
}

try {
  await mkdir(BURETTE_BROWSER_ARTIFACTS, { recursive: true });
  for (const { width, colorScheme, reducedMotion } of matrix) {
    const context = await browser.newContext({ viewport: { width, height: 984 }, colorScheme, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    const evidence = name => join(BURETTE_BROWSER_ARTIFACTS, `${colorScheme}-${width}-${name}`);
    const row = { width, colorScheme, reducedMotion };
    results.push(row);
    try {
      await checkWorkspace(page, evidence, row);
      assert.deepEqual(errors, [], "No uncaught page errors");
      row.status = "passed";
      console.log(`Passed ${colorScheme} ${width}px (${reducedMotion})`);
    } catch (error) {
      row.status = "failed";
      row.error = error.stack;
      row.pageErrors = errors;
      console.error(error);
      await page.screenshot({ path: evidence("failure.png"), timeout: 5000 }).catch(() => {});
    } finally {
      await context.close();
    }
  }
  await writeFile(join(BURETTE_BROWSER_ARTIFACTS, "workspace-shell-browser.json"), JSON.stringify(results, null, 2));
  assert.equal(results.filter(row => row.status === "passed").length, matrix.length, "All browser scenarios pass");
} finally {
  await browser.close();
}
