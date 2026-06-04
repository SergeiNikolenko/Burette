import { syntaxTree } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

export type MarkdownOpenPaths = (paths: string[]) => void | Promise<void>;

function parentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

function isExternalUrl(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function stripFragmentAndQuery(href: string) {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) return href;
  return href.slice(0, Math.min(...indexes));
}

function resolveLocalPath(href: string, filePath: string) {
  const cleanHref = decodeURIComponent(stripFragmentAndQuery(href));
  if (!cleanHref) return null;
  if (cleanHref.startsWith("/")) return cleanHref;
  const parent = parentDirectory(filePath);
  return parent ? `${parent}/${cleanHref}` : cleanHref;
}

function getLinkHref(view: EditorView, pos: number) {
  let href: string | undefined;
  syntaxTree(view.state).iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name !== "Link") return;

      const cursor = node.node.cursor();
      if (!cursor.firstChild()) return false;
      do {
        if (cursor.name === "URL") {
          href = view.state.doc.sliceString(cursor.from, cursor.to);
          return false;
        }
      } while (cursor.nextSibling());

      return false;
    },
  });
  return href;
}

function getRawUrl(view: EditorView, pos: number) {
  let href: string | undefined;
  syntaxTree(view.state).iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name !== "URL") return;
      if (node.node.parent?.name === "Link") return false;
      href = view.state.doc.sliceString(node.from, node.to);
      return false;
    },
  });
  return href;
}

async function followLink(href: string | null, filePath: string, openPaths?: MarkdownOpenPaths) {
  if (!href) return;
  if (/^https?:\/\//i.test(href)) {
    await openUrl(href);
    return;
  }
  if (isExternalUrl(href)) {
    await openUrl(href);
    return;
  }

  const localPath = resolveLocalPath(href, filePath);
  if (!localPath) return;
  if (openPaths) {
    await openPaths([localPath]);
    return;
  }
  await openPath(localPath);
}

export function markdownLinkNavigation(
  getFilePath: () => string,
  isDisposed: () => boolean,
  openPaths?: MarkdownOpenPaths,
): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const target = event.target;
        if (!(target instanceof Element)) return false;

        const htmlAnchor = target.closest(".cm-html-block-widget a");
        if (htmlAnchor instanceof HTMLAnchorElement) {
          event.preventDefault();
          event.stopPropagation();
          void followLink(htmlAnchor.getAttribute("href"), getFilePath(), openPaths).catch((error) => {
            if (!isDisposed()) console.error("[text-file-viewer] Failed to open link:", error);
          });
          return true;
        }

        const isRenderedLink = target.closest(".cm-rendered-link") !== null;
        const isRawUrl = target.closest(".cm-url") !== null;
        if (!isRenderedLink && !isRawUrl) return false;

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        const href = isRenderedLink ? getLinkHref(view, pos) : getRawUrl(view, pos);
        if (!href) return false;

        event.preventDefault();
        event.stopPropagation();
        void followLink(href, getFilePath(), openPaths).catch((error) => {
          if (!isDisposed()) console.error("[text-file-viewer] Failed to open link:", error);
        });
        return true;
      },
    }),
  );
}
