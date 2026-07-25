#!/usr/bin/env node
// The inspector's composition list and the viewer's scene tree show the same
// objects, so a row has to read the same in both. They cannot share a component:
// the tree is built with plain DOM inside the Mol* srcdoc iframe and the panel is
// React in the host document, two runtimes with no stylesheet and no module in
// common. Every shared number is therefore written down twice, and the only thing
// that stops the copies drifting is this file - which compares them to each other
// rather than to a literal, so a change on either side has to be made on both.
import assert from "node:assert/strict";
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

// Reads `NAME = { key: ['path', …] }` out of either file. Path data never
// contains a quote, so pulling the quoted runs out of each array is enough and
// works the same for the viewer's single quotes and the panel's double ones.
function iconPaths(source, name) {
  const start = source.indexOf(`${name} = {`);
  assert.ok(start !== -1, `no ${name} in source`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) {
      end = index;
      break;
    }
  }
  assert.ok(end !== -1, `${name} is not closed`);
  const icons = {};
  for (const [, key, list] of source.slice(open + 1, end).matchAll(/(\w+)\s*:\s*\[([\s\S]*?)\]/g)) {
    icons[key] = Array.from(list.matchAll(/['"]([^'"]+)['"]/g), ([, path]) => path);
  }
  return icons;
}

// A glyph that means "hide" has to be the same mark in both lists.
const treeIcons = iconPaths(viewerJs, "SCENE_TREE_ICON");
const panelIcons = iconPaths(panel, "SCENE_TREE_GLYPH");
const sharedGlyphs = Object.keys(panelIcons);
assert.deepEqual(sharedGlyphs.sort(), ["chevron", "eye", "eyeOff", "trash"]);
for (const key of sharedGlyphs) {
  assert.ok(treeIcons[key], `the scene tree has no ${key} icon to copy`);
  assert.deepEqual(
    panelIcons[key],
    treeIcons[key],
    `${key} is drawn differently in the panel than in the scene tree`
  );
}
assert.match(panel, /strokeWidth="1\.8"/);
assert.match(viewerJs, /setAttribute\('stroke-width', '1\.8'\)/);

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
assert.match(styles, /\.structure-brief-action-entry\[data-hidden="true"\] \.structure-inspector-row-bar/);
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
