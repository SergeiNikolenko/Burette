const views = new Map<string, string>();

export function rememberRendererViewState(path: string, value: unknown) {
  if (!value || typeof value !== "object") return;
  const text = JSON.stringify(value);
  if (text.length > 8192) return;
  views.delete(path);
  views.set(path, text);
  if (views.size > 32) views.delete(views.keys().next().value!);
}

export function rendererViewReloadOptions(path: string) {
  return { rendererViewState: views.get(path) ?? null };
}
