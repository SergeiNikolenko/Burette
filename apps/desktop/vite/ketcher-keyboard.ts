// The macro core also exists in molecule mode. Its document listener must not
// dispatch sequence-edit commands for keys belonging to the surrounding page.
export function scopeKetcherKeyboard(code: string) {
  const hotKeys = "value: function handleHotKeyEvents(event) {";
  const keyboard = "this.keydownEventHandler = function (event) {";
  for (const boundary of [hotKeys, keyboard]) {
    if (code.split(boundary).length !== 2) throw new Error("Ketcher keyboard dispatch contract changed.");
  }
  const typeReference = code.slice(code.indexOf(hotKeys)).match(/^value: function handleHotKeyEvents\(event\) \{\s*var _keySettings\$shortcut;\s*if \(this\._type === ((?:editor_types\.)?EditorType\.Micromolecules)\) return;/u)?.[1];
  if (!typeReference) throw new Error("Ketcher keyboard dispatch contract changed.");
  const guard = `if (this._type === ${typeReference} || !this.ketcherRootElement || !event.target || !this.ketcherRootElement.contains(event.target)) return;`;
  // The document listener closes over _this6; the hotkey method uses this.
  const blurReference = code.match(/this\.canvas\.addEventListener\('mousedown', ((?:dom\.)?blurActiveElement)\);/u)?.[1];
  if (!blurReference) throw new Error("Ketcher canvas focus contract changed.");
  const addFocus = `this.canvas.addEventListener('mousedown', ${blurReference});`;
  const removeFocus = `this.canvas.removeEventListener('mousedown', ${blurReference});`;
  for (const boundary of [addFocus, removeFocus]) {
    if (code.split(boundary).length !== 2) throw new Error("Ketcher canvas focus contract changed.");
  }
  // Upstream blurs the active element when its SVG is clicked, leaving BODY as
  // the keyboard target. Focus the owning root so canvas keys remain scoped.
  code = code.replace(addFocus, `this.buretteFocusCanvas = () => {
        ${blurReference}();
        if (this.ketcherRootElement) {
          this.ketcherRootElement.tabIndex = -1;
          this.ketcherRootElement.focus({ preventScroll: true });
        }
      };
      this.canvas.addEventListener('mousedown', this.buretteFocusCanvas);`)
    .replace(removeFocus, "this.canvas.removeEventListener('mousedown', this.buretteFocusCanvas);");
  return code.replace(hotKeys, `${hotKeys}\n      ${guard}`)
    .replace(keyboard, `${keyboard}\n        ${guard.replaceAll("this.", "_this6.")}`);
}
