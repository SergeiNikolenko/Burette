import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every dialog under components shares one visual vocabulary: NativeSelect for
// drop-downs, a classed row for every checkbox, CSS classes instead of inline
// layout, a header close button, and only classes that styles.css defines.
const componentsRoot = 'apps/desktop/src/components';
const styles = readFileSync('apps/desktop/src/styles.css', 'utf8');

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.tsx') && /<(?:Dialog(?:\.Root|Content)?|AlertDialog|KetcherDialog)\b/.test(readFileSync(path, 'utf8'))) out.push(path);
  }
  return out;
}

const dialogFiles = walk(componentsRoot).filter((file) => !file.endsWith('/ui/dialog.tsx')).sort();
assert.ok(dialogFiles.some((file) => file.endsWith('folder-open-dialog.tsx')), 'folder-open dialog is scanned');
assert.ok(dialogFiles.some((file) => file.endsWith('merge-columns-dialog.tsx')), 'merge-columns dialog is scanned');

const problems = [];
const report = (file, message) => problems.push(`${relative('.', file)}: ${message}`);

for (const file of dialogFiles) {
  const source = readFileSync(file, 'utf8');
  const name = relative(componentsRoot, file);

  // A raw <select> misses the NativeSelect chrome; the ui primitive itself is
  // the only place that renders one.
  if (!name.startsWith('ui/') && /<select\b/.test(source)) {
    report(file, 'renders a bare <select>; use NativeSelect from ./ui/native-select');
  }

  // Every checkbox needs a styling hook, either on the input or on the label
  // wrapping it.
  const checkboxPattern = /<input\b[^>]*type="checkbox"[^>]*>/g;
  for (const match of source.matchAll(checkboxPattern)) {
    const input = match[0];
    if (/className=/.test(input)) continue;
    const before = source.slice(0, match.index);
    const labelStart = before.lastIndexOf('<label');
    const labelHasClass = labelStart >= 0
      && /^<label\b[^>]*className=/.test(before.slice(labelStart))
      && !/<\/label>/.test(before.slice(labelStart));
    if (!labelHasClass) report(file, 'checkbox without a className on the input or its label');
  }

  // Inline layout for lists belongs to a CSS rule, not to the markup.
  for (const match of source.matchAll(/style=\{\{[^}]*\}\}/g)) {
    if (/maxHeight|overflow/.test(match[0])) report(file, `inline scroll layout ${match[0]}`);
  }

  // A dialog with the bespoke header also gets its close button.
  if (/radix-dialog-header/.test(source) && !/radix-dialog-close/.test(source)) {
    report(file, 'radix-dialog-header without a radix-dialog-close button');
  }
  if (/className="radix-dialog-close"/.test(source) && !/CloseIcon/.test(source)) {
    report(file, 'radix-dialog-close without the shared CloseIcon glyph');
  }

  // The content is described for assistive tech, either by aria-describedby
  // on the content or by a Dialog.Description in it.
  if (/Dialog\.Root|<Dialog\b/.test(source) && !/aria-describedby=|Dialog\.Description|DialogDescription/.test(source)) {
    report(file, 'dialog content without aria-describedby or a description');
  }

  // Every radix-dialog-* and dialog-* class the markup uses has a rule.
  for (const match of source.matchAll(/className="([^"]+)"/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (!/^(radix-)?dialog-/.test(token)) continue;
      if (!styles.includes(`.${token}`)) report(file, `dead class ${token}`);
    }
  }
}

assert.deepEqual(problems, [], `dialog consistency problems:\n${problems.join('\n')}`);

// The shared rules the dialogs rely on.
assert.match(styles, /\.radix-dialog-footer \{[^}]*display: flex;[^}]*justify-content: flex-end;[^}]*gap: 8px;[^}]*padding: 0 16px 16px;/s);
assert.match(styles, /\.radix-dialog-footer\.calculate-properties-footer \{[^}]*justify-content: space-between;/s);
assert.match(styles, /\.calculate-properties-option,\s*\.radix-dialog-check-row \{/);
assert.match(styles, /\.radix-dialog-check-row input\[type="checkbox"\] \{[^}]*accent-color: var\(--accent\);/s);
assert.match(styles, /\.radix-dialog-scroll-list \{[^}]*max-height: 240px;[^}]*overflow-y: auto;/s);
assert.match(styles, /\.radix-dialog-subline \{[^}]*color: var\(--text-muted\);/s);
assert.match(styles, /\.calculated-column-field select:not\(\[data-slot="native-select"\]\) \{/);
assert.match(styles, /\.calculated-column-field \[data-slot="native-select-wrapper"\] \{\s*width: 100%;/);

// The folder opener follows the bins dialog: NativeSelect for the mode, classed
// checkbox rows, a scrolling list and the muted path line.
const folderOpen = readFileSync(`${componentsRoot}/folder-open-dialog.tsx`, 'utf8');
assert.match(folderOpen, /<NativeSelect size="sm" value=\{mode\}/);
assert.match(folderOpen, /<p className="radix-dialog-subline">\{path\}<\/p>/);
assert.match(folderOpen, /<div className="radix-dialog-scroll-list folder-open-file-list"/);
assert.match(folderOpen, /aria-describedby="folder-open-body"/);
assert.doesNotMatch(folderOpen, /<label><input/);

console.log(`dialog consistency: ${dialogFiles.length} dialogs pass`);
