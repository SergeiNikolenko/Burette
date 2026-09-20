import type { AnimationSource } from '../components/xyzrender-animation-dialog';
export async function exportXyzrenderFigure(source: AnimationSource, format: string, signal?: AbortSignal) {
  const response = await fetch('/__burette/xyzrender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ ...source, previewSvg: undefined, exportFormat: format }) });
  const body = await response.json();
  if (!response.ok || !body.artifactBase64) throw new Error(body.error || 'Export failed');
  const saved = await fetch('/__burette/xyzrender-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ name: source.label, format, dataBase64: body.artifactBase64 }) });
  const result = await saved.json();
  if (!saved.ok) throw new Error(result.error || 'Could not save figure');
  const link = document.createElement('a'); link.href = result.downloadUrl; link.download = result.name;
  document.body.append(link); link.click(); link.remove();
  return result as { name: string; path: string; downloadUrl: string };
}
