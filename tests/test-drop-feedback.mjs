import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const feedbackSource = readFileSync('apps/desktop/src/components/file-drop-feedback.tsx', 'utf8').replace(/^import.*;\n/gm, '').replace('export function FileDropFeedback', 'function FileDropFeedback');
const Feedback = new Function('React', ts.transpileModule(feedbackSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText + '\nreturn FileDropFeedback;')({ createElement });
const preview = { actionLabel: 'Save molecules in folder', targetLabel: 'sdf', itemLabel: 'ethanol.sdf', targetKind: 'sidebar', bounds: { left: 12, top: 218, width: 216, height: 30 }, point: { x: 80, y: 232 } };
const markup = point => renderToStaticMarkup(createElement(Feedback, { preview: { ...preview, point } }));
assert.equal(markup(preview.point), markup({ x: 190, y: 240 }));
assert.ok(markup(preview.point).includes('--file-drop-target-left:12px'));
console.log('Drop feedback stays anchored to the exact destination while the pointer moves');
