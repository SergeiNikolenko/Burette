import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createArtworkSanitizer } from "../scripts/svg-sanitizer.mjs";
const window = new JSDOM("").window;
const document = window.document;
window.BuretteSanitizeArtwork = createArtworkSanitizer(window);
const clean = window.BuretteSanitizeArtwork;
const unsafe = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(1)">x</div></foreignObject>
<script>alert(1)</script><style>body { display:none } @import 'https://evil.invalid/a';</style>
<image href="https://evil.invalid/a"/><use href="javascript:alert(1)"/>
<path onclick="alert(1)" style="fill:url(https://evil.invalid/a);position:fixed;stroke:red"/>
<animate attributeName="href" values="javascript:alert(1)"/>
</svg><img src="x" onerror="alert(1)">`;
const host = document.createElement("div");
host.innerHTML = clean(unsafe);
assert.equal(host.querySelectorAll("script,foreignObject,style,animate,img").length, 0);
assert.equal(host.querySelectorAll("[onload],[onclick],[onerror]").length, 0);
assert.ok(!host.innerHTML.includes("evil.invalid") && !host.innerHTML.includes("javascript:"));
assert.equal(host.querySelector("path").style.stroke, "red");
assert.equal(host.querySelector("path").style.position, "");
for (const bad of ["url(//evil.invalid/a)", "url('file:///etc/passwd')", "u\\72l(https://evil.invalid/a)", "var(--attacker)"]) {
  host.innerHTML = clean(`<svg xmlns="http://www.w3.org/2000/svg"><path fill="${bad}"/></svg>`);
  assert.equal(host.querySelector("path").hasAttribute("fill"), false, bad);
}
const valid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><radialGradient id="x0g3"><stop offset="0%" stop-color="red"/></radialGradient></defs><path data-atom-index="3" data-smiles="N[C@@H](C)C(=O)O" class="buret-xyzrender-svg-selection" style="fill:url(#x0g3);stroke-width:2" d="M0 0L1 1"/></svg>`;
host.innerHTML = clean(valid);
assert.equal(host.querySelector("path").getAttribute("data-atom-index"), "3");
assert.equal(host.querySelector("path").getAttribute("data-smiles"), "N[C@@H](C)C(=O)O");
assert.ok(host.querySelector("radialGradient") && host.querySelector("path").style.fill.includes("#x0g3"));
assert.ok(host.querySelector("path").classList.contains("buret-xyzrender-svg-selection"));
host.innerHTML = clean('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop style="stop-color:red;stop-opacity:0.5"/><stop style="stop-color:blue"/></linearGradient></defs></svg>');
assert.equal(host.querySelector("stop").style.getPropertyValue("stop-color"), "red");
assert.equal(host.querySelector("stop").style.getPropertyValue("stop-opacity"), "0.5");
const animation = '<img class="buret-xyzrender-animation-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" onclick="alert(1)" style="position:fixed">';
host.innerHTML = clean(valid + animation);
assert.equal(host.querySelector("img").style.position, "absolute");
assert.equal(host.querySelector("img").getAttribute("onclick"), null);
assert.ok(host.querySelector("img").getAttribute("src").startsWith("data:image/gif;base64,"));
const source = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 2);
  const end = tail.search(/\n  (?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}
const api = new Function("window", "document", `
 const escapeHTML = value => value;
 const rotatableArtifactControlsHTML = () => '';
 const xyzrenderSelectedElements = new Set();
 const xyzrenderAtomSetFromSelector = () => new Set();
 const xyzrenderAtomSelectorForElements = () => '';
 const cleanupXyzrenderSelectionSet = () => {};
 const restoreNullableAttribute = () => {};
 const setXyzrenderSheetItemEntry = () => {};
 const layoutAddedXyzrenderSheetItems = () => {};
 const selectRotatableArtifact = () => {};
 const installXyzrenderSheetItemInteractions = () => {};
 ${["externalArtifactBaseItemHTML", "updateXyzrenderSheetItemBody", "addXyzrenderSheetItem", "restoreXyzrenderActionSnapshot"].map(declaration).join("\n")}
 return { externalArtifactBaseItemHTML, updateXyzrenderSheetItemBody, addXyzrenderSheetItem, restoreXyzrenderActionSnapshot };
`)(window, document);
const sheet = document.createElement("div");
sheet.innerHTML = api.externalArtifactBaseItemHTML(unsafe, "fixture");
const item = sheet.firstElementChild;
api.updateXyzrenderSheetItemBody(item, unsafe);
api.addXyzrenderSheetItem(sheet, unsafe, "molecule.xyz", { x: 1, y: 1 }, 1, () => 1);
api.restoreXyzrenderActionSnapshot({ item, bodyHtml: unsafe });
assert.equal(sheet.querySelectorAll("[onload],[onclick],script,foreignObject,object").length, 0);
api.updateXyzrenderSheetItemBody(item, valid + animation);
assert.ok(item.querySelector("[data-atom-index]"));
assert.ok(item.querySelector(".buret-xyzrender-animation-image"));
assert.ok(!source.includes('<object class="buret-external-artifact-object"'));
const gallery = new URL("../apps/desktop/public/xyzrender-gallery/", import.meta.url);
for (const file of readdirSync(gallery).filter(name => name.endsWith(".svg"))) {
  const raw = readFileSync(new URL(file, gallery), "utf8");
  const before = new window.DOMParser().parseFromString(raw, "image/svg+xml");
  host.innerHTML = clean(raw);
  for (const tag of ["path", "circle", "ellipse", "radialGradient", "linearGradient", "text"]) {
    assert.equal(host.querySelectorAll(tag).length, before.querySelectorAll(tag).length, `${file}: ${tag}`);
  }
}
console.log("SVG injection rejected across base/add/update/undo; scientific graphics and applied animation retained.");
