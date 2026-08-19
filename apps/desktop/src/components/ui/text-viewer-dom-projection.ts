"use client";

export function patchKeyedDomChildren<Item, Element extends HTMLElement>({
  createElement,
  getKey,
  items,
  parent,
  updateElement,
}: {
  createElement: (item: Item) => Element;
  getKey: (item: Item) => string;
  items: readonly Item[];
  parent: HTMLElement;
  updateElement: (element: Element, item: Item) => void;
}) {
  const existing = new Map<string, Element>();
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement)) {
      child.remove();
      continue;
    }

    const key = child.dataset.projectionKey;
    if (!key || existing.has(key)) {
      child.remove();
      continue;
    }
    existing.set(key, child as Element);
  }

  let cursor: ChildNode | null = parent.firstChild;
  const usedKeys = new Set<string>();

  for (const item of items) {
    const key = getKey(item);
    let element = existing.get(key);
    if (!element || usedKeys.has(key)) {
      element = createElement(item);
      element.dataset.projectionKey = key;
    }
    usedKeys.add(key);
    updateElement(element, item);

    if (element.parentNode !== parent || element !== cursor) {
      parent.insertBefore(element, cursor);
      continue;
    }
    cursor = cursor.nextSibling;
  }

  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}
