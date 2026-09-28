import { afterEach, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnnotationLayer, AnnotateToggle } from '../apps/desktop/src/components/annotation-layer';
import { useAnnotationStore } from '../apps/desktop/src/stores/annotation-store';
import { deliverAnnotations } from '../apps/desktop/src/lib/annotation-region';

const previousWindow = globalThis.window;
afterEach(() => { useAnnotationStore.getInitialState().active = false; useAnnotationStore.setState({ active: false }); globalThis.window = previousWindow; });
function workspace(sendAnnotations = async (_value: unknown) => {}) {
  globalThis.window = { BuretteMcpWorkspace: { sendAnnotations } } as unknown as Window & typeof globalThis;
}
test('annotation entry remains visibly labelled before activation', () => {
  workspace();
  const html = renderToStaticMarkup(<AnnotateToggle />);
  expect(html).toContain('<span>Annotate</span>');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('Annotate this page');
  expect(html).toContain('⌘.');
});
test('reference toolbar keeps its controls in order, with an explicit zero count', () => {
  workspace(); useAnnotationStore.getInitialState().active = true; useAnnotationStore.setState({ active: true });
  const html = renderToStaticMarkup(<AnnotationLayer documentTitle="1STP" picksResidues={true} />);
  const controls = ['Annotating · 0', 'Take a screenshot', 'Hide markers', 'Toggle screenshot preview', 'Discard annotations', '>Send</button>', 'Close annotations'];
  let previous = -1;
  for (const control of controls) { const index = html.indexOf(control); expect(index).toBeGreaterThan(previous); previous = index; }
  expect(html).toContain('aria-label="Select in the structure"');
  expect(html).not.toContain('>Cancel<');
});
test('explicit captured screenshot is sent once with molecular context', async () => {
  const calls: unknown[] = [];
  workspace(async value => { calls.push(value); });
  const image = { data: 'test-image', mimeType: 'image/jpeg' };
  expect(await deliverAnnotations('1STP', [{id: 1,rect: {left:0,top:0,width:10,height:10},pin:{x:0,y:0},comment:'Explain this atom',target:{surface:'molstar',atomCount:1,atomIdentities:[{chain:'A',sequence:300,compId:'BTN',atomName:'O1',atomIndex:9}]}}], image)).toBe('sent');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({image,text:expect.stringContaining('BTN300 O1')});
});
