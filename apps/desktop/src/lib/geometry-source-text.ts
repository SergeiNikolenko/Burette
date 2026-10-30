/** Raw XYZ enters the renderer through UTF-8 TextDecoder, which consumes one BOM.
 * This is a display-text projection, never a source identity or a source rewrite.
 * Logical MOLX sources already retain the exact text stored in the model snapshot.
 */
export function rendererXyzText(sourceText: string) {
  return sourceText.startsWith("\uFEFF") ? sourceText.slice(1) : sourceText;
}
