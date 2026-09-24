import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from './tauri';
import { isPeriodicXyz, rotatePeriodicXyz, rotateXyzrenderReference } from './xyzrender-orientation';
import { safeExportFileName } from './file-export';

type RenderRequest = {
  path: string;
  preset?: string;
  controls?: Record<string, unknown>;
  inputDataBase64?: string;
  inputExtension?: string;
  animationSourcePath?: string;
  animationSourceExtension?: string;
  orientationRef?: string;
  orientation?: number[];
  animation?: Record<string, unknown>;
  exportFormat?: string;
};
type RenderResult = { svg: string; orientationRef?: string; baseOrientationRef?: string; gifBase64?: string; artifactBase64?: string };
let nativeAnimationQueue: Promise<unknown> = Promise.resolve();

export type SavedXyzrenderFile = { name: string; path: string; downloadUrl?: string };

export async function renderXyzrender(request: RenderRequest, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const fullTrajectory = request.animationSourcePath && ['trajectory', 'vibration'].includes(String(request.animation?.mode));
  // The sheet's inline input is a selected static frame. Motion needs the
  // original file, while synthetic/edited items keep their inline coordinates.
  if (fullTrajectory && request.animationSourcePath) {
    request = { ...request, path: request.animationSourcePath, inputDataBase64: undefined,
      inputExtension: request.animationSourceExtension };
  }
  const inlineXyz = request.orientation && request.inputDataBase64 && (request.inputExtension || request.path.split('.').pop())?.toLowerCase() === 'xyz'
    ? atob(request.inputDataBase64)
    : undefined;
  const periodicInput = inlineXyz && isPeriodicXyz(inlineXyz) ? inlineXyz : undefined;
  let periodicOrientationRef: string | undefined;
  let baseOrientationRef = request.orientationRef;
  if (request.orientation && periodicInput) {
    baseOrientationRef = request.orientationRef && isPeriodicXyz(request.orientationRef) ? request.orientationRef : periodicInput;
    periodicOrientationRef = rotatePeriodicXyz(baseOrientationRef, request.orientation);
    request = { ...request, inputDataBase64: btoa(periodicOrientationRef), orientationRef: undefined, orientation: undefined };
  } else if (request.orientationRef && isPeriodicXyz(request.orientationRef)) {
    if (fullTrajectory) {
      request = { ...request, orientationRef: undefined };
    } else {
      periodicOrientationRef = request.orientationRef;
      request = { ...request, inputDataBase64: btoa(periodicOrientationRef), inputExtension: 'xyz', orientationRef: undefined };
    }
  }
  if (!isTauriRuntime()) {
    const response = await fetch('/__burette/xyzrender', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(request),
    });
    if (!periodicOrientationRef) return response;
    return Response.json({ ...await response.json(), orientationRef: periodicOrientationRef, baseOrientationRef }, { status: response.status });
  }
  try {
    if (request.orientation) {
      if (!baseOrientationRef) {
        const base = await invoke<RenderResult>('render_xyzrender_editor', { request: { ...request, animation: undefined, saveReference: true } });
        signal?.throwIfAborted();
        baseOrientationRef = base.orientationRef;
      }
      if (!baseOrientationRef) throw new Error('xyzrender did not produce an orientation reference');
      request = { ...request, orientationRef: rotateXyzrenderReference(baseOrientationRef, request.orientation) };
    }
    const invokeRender = () => {
      signal?.throwIfAborted();
      return invoke<RenderResult>('render_xyzrender_editor', { request });
    };
    // Keep one native animation in flight; obsolete queued angle changes never
    // start a process. A second native slot stays available for orientation.
    const pending = request.animation ? nativeAnimationQueue.then(invokeRender) : invokeRender();
    if (request.animation) nativeAnimationQueue = pending.catch(() => {});
    const result = await pending;
    signal?.throwIfAborted();
    return Response.json({ ...result, orientationRef: periodicOrientationRef || result.orientationRef, baseOrientationRef });
  } catch (cause) {
    signal?.throwIfAborted();
    return Response.json({ error: String(cause) }, { status: 500 });
  }
}

export async function saveXyzrenderFile(name: string, format: string, dataBase64: string, signal?: AbortSignal): Promise<SavedXyzrenderFile | null> {
  signal?.throwIfAborted();
  name = safeExportFileName(name.replace(/\.(gif|svg|png|pdf|tiff)$/i, '') + '.' + format);
  if (isTauriRuntime()) {
    const outputPath = await save({ defaultPath: name, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    signal?.throwIfAborted();
    if (!outputPath) return null;
    const path = await invoke<string>('write_base64_file', { request: { outputPath, contentsBase64: dataBase64 } });
    return { name, path };
  }
  const response = await fetch('/__burette/xyzrender-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ name, format, dataBase64 }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save figure');
  const link = document.createElement('a'); link.href = result.downloadUrl; link.download = result.name;
  document.body.append(link); link.click(); link.remove();
  return result;
}
