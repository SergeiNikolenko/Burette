#!/usr/bin/env node
// The inspector's composition list and the viewer's scene tree show the same
// objects, so a row has to read the same in both. They cannot share a component:
// the tree is built with plain DOM inside the Mol* srcdoc iframe and the panel is
// React in the host document, with separate stylesheets and icon renderers.
// Compare both rendered glyphs and shared layout values across those boundaries
// so a change on either side has to be reflected on the other.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import * as appIcons from "../apps/desktop/src/components/ui/app-icons.tsx";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

const viewerJs = await read("PreviewExtension/Web/viewer.js");
const viewerCss = await read("PreviewExtension/Web/viewer-runtime.css");
const panel = await read("apps/desktop/src/components/structure-info-panel.tsx");
const styles = await read("apps/desktop/src/styles.css");
const button = await read("apps/desktop/src/components/ui/button.tsx");

function ruleBody(css, selector, label) {
  const escaped = selector.replace(/[.[\]*+?^${}()|\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${label}: no rule for ${selector}`);
  return match[1];
}

function declaration(body, property) {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
}

// Evaluate only the declarative glyph maps and isolated DOM renderer. The
// iframe embeds SDK nodes, while the panel reaches them through React exports.
const embeddedIcons = JSON.parse(viewerJs.match(/const APP_ICON_DATA = (.+);\n/)?.[1] ?? "null");
assert.ok(embeddedIcons, "viewer has no embedded SDK icon data");
const treeMap = viewerJs.match(/const SCENE_TREE_ICON = (\{[\s\S]*?\n  \});/)?.[1];
assert.ok(treeMap, "viewer has no scene tree icon map");
const treeIcons = new Function("APP_ICON_DATA", `return (${treeMap});`)(embeddedIcons);
const renderer = viewerJs.match(/function sceneTreeIconElement\(paths\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(renderer, "viewer has no scene tree icon renderer");
const window = new Window();
const renderTreeIcon = new Function("document", "SCENE_TREE_SVG_NS", `${renderer}; return sceneTreeIconElement;`)(
  window.document, "http://www.w3.org/2000/svg",
);
function contourNodes(svg) {
  return Array.from(svg.children, (node) => ({
    tag: node.tagName.toLowerCase(),
    attributes: Object.fromEntries(Array.from(node.attributes, ({ name, value }) => [name, value])
      .filter(([name]) => name !== "class")),
  }));
}
try {
  for (const [key, name, component] of [
    ["chevron", "ChevronRight", "TreeDisclosureIcon"],
    ["eye", "Eye", "EyeIcon"],
    ["eyeOff", "EyeOff", "EyeOffIcon"],
    ["trash", "Delete", "TrashIcon"],
  ]) {
    // Check the actual panel mapping too: equal unused exports prove nothing.
    const local = panel.match(new RegExp(`\\b${name} as (\\w+)`))?.[1];
    assert.ok(local, `panel does not import the ${name} icon`);
    assert.match(panel, new RegExp(`function ${component}\\(\\) \\{\\s*return <${local}\\b`));
    const host = window.document.createElement("div");
    host.innerHTML = renderToStaticMarkup(React.createElement(appIcons[name], { size: key === "chevron" ? 11 : 13 }));
    const treeSvg = renderTreeIcon(treeIcons[key]);
    assert.equal(host.firstElementChild.getAttribute("viewBox"), treeSvg.getAttribute("viewBox"));
    assert.deepEqual(contourNodes(host.firstElementChild), contourNodes(treeSvg), `${key} differs between panel and scene tree`);
    assert.ok(treeSvg.children.length > 0, `${key} must not render an empty glyph`);
  }
  // Scientific focus/isolation marks retain their legacy stroked paths.
  for (const key of ["focus", "isolate"]) {
    assert.ok(treeIcons[key].length > 0 && treeIcons[key].every((path) => typeof path === "string"));
    const svg = renderTreeIcon(treeIcons[key]);
    assert.equal(svg.getAttribute("stroke-width"), "1.8");
    assert.equal(svg.getAttribute("stroke"), "currentColor");
    assert.equal(svg.getAttribute("fill"), "none");
    assert.deepEqual(contourNodes(svg), treeIcons[key].map((d) => ({ tag: "path", attributes: { d } })));
  }
} finally {
  await window.happyDOM.close();
}

// The colour bar ahead of the name.
const treeBar = ruleBody(viewerCss, ".buret-tree-bar", "viewer");
const panelBar = ruleBody(styles, ".structure-inspector-row-bar", "panel");
for (const property of ["width", "height", "border-radius"]) {
  assert.equal(
    declaration(panelBar, property),
    declaration(treeBar, property),
    `the composition bar's ${property} no longer matches the scene tree's`
  );
}
// The tree fades a row to 0.45 only once it is hidden. The panel carried that
// permanently, which washed out every colour in the list; neither may declare it
// on the bar itself.
assert.equal(declaration(treeBar, "opacity"), null);
assert.equal(declaration(panelBar, "opacity"), null);
// Each tone wears its own colour, the one its slice has in the segmented
// composition bar; a single colour for all four once collapsed the tree.
const toneColours = ["polymer", "ligand", "ion", "water"].map((tone) => {
  const rowTone = declaration(ruleBody(styles, `.structure-inspector-row-bar[data-tone="${tone}"]`, "panel"), "background");
  const barTone = declaration(ruleBody(styles, `.structure-inspector-composition-bar i[data-tone="${tone}"]`, "panel"), "background");
  assert.ok(rowTone, `the ${tone} row bar has no colour`);
  assert.equal(rowTone, barTone, `the ${tone} row bar and composition slice disagree`);
  return rowTone;
});
assert.equal(new Set(toneColours).size, 4, `the four row-bar tones must be distinct, got ${toneColours.join(", ")}`);
// The viewer's own colour for the entity, when known, beats the tone.
assert.match(panel, /className="structure-inspector-row-bar" data-tone=\{tone\} style=\{color \? \{ backgroundColor: color \} : undefined\}/);
assert.ok(styles.includes('.structure-brief-action-entry[data-hidden="true"] .structure-brief-chip-button'), "hidden child rows must fade their contents once");
assert.match(viewerCss, /\.buret-tree-item\[data-hidden="true"\][^{]*\.buret-tree-bar/);

// Row height, and the twisty that sets the indent.
assert.equal(
  declaration(ruleBody(styles, ".structure-inspector-tree .structure-brief-action-entry", "panel"), "min-height"),
  declaration(ruleBody(viewerCss, ".buret-tree-row", "viewer"), "min-height")
);
const treeTwisty = ruleBody(viewerCss, ".buret-tree-twisty", "viewer");
const panelTwisty = ruleBody(styles, ".structure-inspector-tree-toggle,\n.structure-inspector-tree-spacer", "panel");
for (const property of ["width", "height"]) {
  assert.equal(declaration(panelTwisty, property), declaration(treeTwisty, property));
}

// Label and figure.
assert.equal(
  declaration(ruleBody(styles, '.structure-inspector-row-content[data-tree="true"] .structure-inspector-row-label', "panel"), "font-size"),
  declaration(ruleBody(viewerCss, ".buret-tree-label", "viewer"), "font-size")
);
assert.equal(
  declaration(ruleBody(styles, '.structure-inspector-row-content[data-tree="true"] em', "panel"), "font-size"),
  declaration(ruleBody(viewerCss, ".buret-tree-note", "viewer"), "font-size")
);

// The 20px row action. The panel gets its box from the design system rather than
// from a hand-rolled button, so the size lives in the Button variants and has to
// agree with the tree's own control.
const treeAction = ruleBody(viewerCss, ".buret-tree-action", "viewer");
assert.equal(declaration(treeAction, "width"), "20px");
assert.equal(declaration(treeAction, "height"), "20px");
assert.equal(declaration(ruleBody(viewerCss, ".buret-tree-action > svg", "viewer"), "width"), "13px");
const iconVariant = button.match(/"icon-2xs":\s*\n?\s*"([^"]+)"/);
assert.ok(iconVariant, "Button has no icon-2xs size");
assert.match(iconVariant[1], /(^|\s)size-5(\s|$)/); // 20px
assert.match(iconVariant[1], /size-\[13px\]/);
assert.match(panel, /size="icon-2xs"\n\s*className="structure-inspector-row-action"/);
// Remove sits ahead of the eye in both lists.
assert.ok(
  panel.indexOf('aria-label={`Remove ${row.label.toLowerCase()}`}') <
    panel.indexOf('aria-label={`${hidden ? "Show" : "Hide"} ${row.label.toLowerCase()}`}'),
  "the composition row puts its eye before its remove button"
);
assert.ok(
  viewerJs.indexOf("sceneTreeActionButton('remove'") < viewerJs.indexOf("sceneTreeActionButton(\n      'visibility'"),
  "the scene tree no longer puts remove before visibility"
);
assert.match(viewerJs, /focusSaveable: label\.startsWith\('\[Focus\]'\)/);
assert.match(viewerJs, /sceneTreeActionButton\('save-focus', `Save \$\{node\.label\}`, SCENE_TREE_ICON\.plus\)/);
assert.ok(
  viewerJs.indexOf("sceneTreeActionButton('save-focus'") < viewerJs.indexOf("sceneTreeActionButton('remove'"),
  "the focus save button is not immediately available before remove"
);
assert.match(viewerJs, /else if \(action === 'save-focus'\) await saveSceneTreeFocusNode\(ref\)/);

// Picking a row tints it flat grey and weights the name. The generic action row
// marks selection with an accent tint and a 3px rail, which landed beside this
// row's colour bar and matched nothing in the render. The panel names the app's
// own token rather than restating the tree's recipe: writing the color-mix out
// here fed Lightning CSS a `transparent` keyword it rewrites into a nested
// @supports block, and the declaration was dropped on the way to the browser.
assert.match(styles, /\.structure-inspector-tree \.structure-brief-action-entry\[data-selected="true"\][\s\S]*?background: var\(--surface-selected\)/);
assert.doesNotMatch(
  styles,
  /\.structure-inspector-tree \.structure-brief-action-entry\[data-selected="true"\][^}]*color-mix\([^)]*transparent\)/
);
// 26% of the contrast ratio lands at 8.53% against the tree's flat 9%.
assert.match(styles, /--surface-selected: color-mix\(in srgb, var\(--fg-base\) calc\(var\(--contrast\) \* 26%\), transparent\)/);
assert.match(viewerCss, /\.buret-tree-item\[data-selected="true"\] > \.buret-tree-row \{[\s\S]*?background: color-mix\(in srgb, var\(--buret-molstar-text\) 9%, transparent\)/);
assert.match(styles, /\.structure-inspector-tree \.structure-brief-action-entry\[data-selected="true"\] \.structure-inspector-row-label \{[\s\S]*?font-weight: 590/);
assert.match(viewerCss, /\.buret-tree-item\[data-selected="true"\][^{]*\.buret-tree-label \{[\s\S]*?font-weight: 590/);

console.log("scene tree parity contract ok");
