import type { AnimationSource } from '../components/xyzrender-animation-dialog';
import { renderXyzrender, saveXyzrenderFile } from './xyzrender-transport';

export async function exportXyzrenderFigure(source: AnimationSource, format: string, signal?: AbortSignal) {
  const response = await renderXyzrender({ ...source, exportFormat: format }, signal);
  const body = await response.json();
  if (!response.ok || !body.artifactBase64) throw new Error(body.error || 'Export failed');
  return saveXyzrenderFile(source.label, format, body.artifactBase64, signal);
}
