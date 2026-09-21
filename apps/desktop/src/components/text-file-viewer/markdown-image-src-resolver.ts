import { convertFileSrc } from "@tauri-apps/api/core";
import { EditorView, ViewPlugin } from "@codemirror/view";

function parentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

function resolveImgSrc(img: HTMLImageElement, markdownDir: string) {
  const src = img.getAttribute("src");
  if (!src) return;
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("asset:") ||
    src.startsWith("data:") ||
    src.startsWith("blob:")
  ) {
    return;
  }
  const absolute = src.startsWith("/") ? src : `${markdownDir}/${src}`;
  img.src = convertFileSrc(absolute);
}

export function markdownImageSrcResolver(getActivePath: () => string | null) {
  return ViewPlugin.fromClass(
    class {
      observer: MutationObserver;

      constructor(view: EditorView) {
        const dir = this.getDir(getActivePath());
        if (dir) this.fixAll(view.dom, dir);

        this.observer = new MutationObserver((mutations) => {
          const activeDir = this.getDir(getActivePath());
          if (!activeDir) return;
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node instanceof HTMLImageElement) resolveImgSrc(node, activeDir);
              else if (node instanceof HTMLElement) {
                for (const img of node.querySelectorAll("img")) {
                  resolveImgSrc(img as HTMLImageElement, activeDir);
                }
              }
            }
          }
        });
        this.observer.observe(view.dom, { childList: true, subtree: true });
      }

      getDir(path: string | null): string | null {
        return path ? parentDirectory(path) : null;
      }

      fixAll(root: HTMLElement, dir: string) {
        for (const img of root.querySelectorAll("img")) resolveImgSrc(img as HTMLImageElement, dir);
      }

      destroy() {
        this.observer.disconnect();
      }
    },
  );
}
