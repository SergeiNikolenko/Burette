const textFindTargets = new Map<HTMLElement, () => void>();

export function registerTextFind(element: HTMLElement, toggle: () => void) {
  textFindTargets.set(element, toggle);
  return () => { textFindTargets.delete(element); };
}

// Native Find and browser shortcuts must reach the visible text viewer, even
// when its read-only content does not currently own keyboard focus.
export function requestTextFind() {
  if (document.querySelector('[role="dialog"][data-state="open"]')) return false;
  const visible = [...textFindTargets].filter(([element]) => {
    const rect = element.getBoundingClientRect();
    return element.isConnected && rect.width > 0 && rect.height > 0
      && getComputedStyle(element).visibility !== "hidden";
  });
  const target = visible.find(([element]) => element.contains(document.activeElement))
    ?? visible.at(-1);
  if (!target) return false;
  target[1]();
  return true;
}
