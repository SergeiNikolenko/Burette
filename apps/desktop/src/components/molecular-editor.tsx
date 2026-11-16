import { useEffect, useEffectEvent, useRef } from 'react';
import type { KetcherEditorApi } from './ketcher-editor';
import type { MolecularEditor, createMolecularEditor } from '../../public/molecular-frame/molecular-frame.js';
import { convertStructure, importStructure } from '../lib/molecular-codecs';

function createEditorApi(frame: MolecularEditor): KetcherEditorApi {
  const changes = new Set<() => void>();
  const selections = new Set<() => void>();
  const zooms = new Set<(zoom: number) => void>();
  let lastSelection = '';
  let lastZoom = frame.editor.getState()?.zoom ?? 100;
  let importGeneration = 0;
  frame.on('change', () => { for (const listener of changes) listener(); });
  frame.on('state', state => {
    const selection = JSON.stringify(state.selectedAtoms);
    if (selection !== lastSelection) { lastSelection = selection; for (const listener of selections) listener(); }
    if (state.zoom !== lastZoom) { lastZoom = state.zoom; for (const listener of zooms) listener(state.zoom / 100); }
  });
  const subscribe = <T,>(set: Set<T>, listener: T) => { set.add(listener); return () => { set.delete(listener); }; };
  const setMolecule = async (value: string) => {
    const generation = ++importGeneration;
    const text = await importStructure(value);
    if (generation !== importGeneration) throw new DOMException('A newer structure was loaded', 'AbortError');
    if (!frame.editor.load(text)) throw new Error('Could not read this structure. The previous drawing is preserved.');
  };
  const addFragment = async (value: string) => {
    const generation = importGeneration;
    const text = await importStructure(value);
    if (generation !== importGeneration) throw new DOMException('The target structure changed', 'AbortError');
    return frame.editor.insert(text);
  };
  const convert = (format: keyof typeof import('ketcher-core')['ChemicalMimeType'], molfileFormat?: 'v2000' | 'v3000') =>
    convertStructure(frame.editor.getMolfile(), format, molfileFormat);
  return {
    cancelPendingImports: () => { importGeneration += 1; },
    setMolecule, setMolfile: setMolecule, addFragment, addMolfileFragment: addFragment,
    containsReaction: () => false,
    getKet: () => convert('KET'),
    getMolfile: async format => format === 'v3000' ? convert('Mol', format) : frame.editor.getMolfile(),
    getSmiles: async extended => extended ? convert('ExtendedSmiles') : frame.editor.getSmiles(),
    getExtendedSmiles: () => convert('ExtendedSmiles'),
    getSdf: async format => format === 'v3000' ? convert('SDF', format) : `${frame.editor.getMolfile().trimEnd()}\n$$$$\n`,
    getSvg: () => frame.editor.getSvg(),
    getSelectedAtomIndexes: () => frame.editor.getState()?.selectedAtoms ?? [],
    setAgentHighlightedAtomIndexes: indexes => frame.editor.highlightAtoms(indexes),
    getZoom: () => (frame.editor.getState()?.zoom ?? 100) / 100,
    setZoom: zoom => { const current = (frame.editor.getState()?.zoom ?? 100) / 100; frame.editor.zoom(zoom / current); },
    switchToMoleculesMode: () => {},
    subscribeChange: listener => subscribe(changes, listener),
    subscribeSelection: listener => subscribe(selections, listener),
    subscribeZoom: listener => subscribe(zooms, listener),
    getCml: () => convert('CML'), getCDXml: () => convert('CDXML'), getCDX: () => convert('CDX'),
    getSmarts: () => convert('DaylightSmarts'), getInchi: withAuxInfo => convert(withAuxInfo ? 'InChIAuxInfo' : 'InChI'), getInChIKey: () => convert('InChIKey'),
    getRxn: format => convert('Rxn', format), getRdf: format => convert('RDF', format),
    getFasta: () => convert('FASTA'), getSequence: () => convert('SEQUENCE'),
    getIdt: () => convert('IDT'), getAxoLabs: () => convert('AXOLABS'),
    setHelm: async () => { throw new Error('HELM editing is not supported by the molecular editor yet.'); },
  };
}

export function MolecularEditorView({ onReady, onStatus, onLoadError, onOpenFile }: {
  onReady: (api: KetcherEditorApi) => void;
  onStatus?: (message: string) => void;
  onOpenFile?: () => void;
  onLoadError?: (error: Error) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useEffectEvent(onReady);
  const openFile = useEffectEvent(() => onOpenFile?.());
  const status = useEffectEvent((message: string) => onStatus?.(message));
  const error = useEffectEvent((message: string) => { onStatus?.(message); onLoadError?.(new Error(message)); });
  useEffect(() => {
    let disposed = false;
    let frame: MolecularEditor | undefined;
    void (async () => {
      const url = new URL('molecular-frame/molecular-frame.js', document.baseURI).href;
      type EditorModule = { createMolecularEditor: typeof createMolecularEditor };
      const transport = (window as Window & { BuretteMcpWorkspace?: { importModule: (path: string) => Promise<EditorModule> } }).BuretteMcpWorkspace;
      const sdk: EditorModule = transport
        ? await transport.importModule('shell/molecular-frame/molecular-frame.js')
        : await import(/* @vite-ignore */ url);
      if (disposed) return;
      frame = sdk.createMolecularEditor(host.current!, { onOpenFile: onOpenFile ? openFile : undefined });
      frame.on('error', value => status(value.message));
      await frame.ready;
      if (!disposed) ready(createEditorApi(frame));
    })().catch(reason => { if (!disposed) error(reason instanceof Error ? reason.message : 'Could not open the molecular editor'); });
    return () => { disposed = true; frame?.destroy(); };
  }, []);
  return <div ref={host} className="molecular-frame-host" style={{ width: '100%', height: '100%', minHeight: 0 }} />;
}
