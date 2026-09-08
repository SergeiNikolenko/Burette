import * as iconData from "./ui/app-icon-data";
import type { MenuItemSpec } from "./menu-types";

// Native template images use the same reviewed SVG geometry as React controls.
const urls = Object.fromEntries(Object.entries(iconData).map(([name, nodes]) => {
  const svg = nodes.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes)
    .filter(([key]) => key !== "key" && key !== "className")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}="${String(value)
      .replaceAll("currentColor", "#000").replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`)
    .join(" ")} />`).join("");
  return [name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${svg}</svg>`)}`];
}));
const aliases: Record<string, keyof typeof iconData> = {
  ArrowUpRight: "ExternalLink", CloseBold: "X", FolderDocumentsFinder: "Folder",
  Grid: "Stack", ImageSquare: "FileImage", OpenRight: "SidebarRight", SelectText: "Clipboard",
  Sidebar: "SidebarLeft", TableFilled: "FileSpreadsheet", Text: "FileDocument", Trash: "Delete",
};
const names: Record<string, string> = {
  'file-open': 'ArrowUpRight', 'folder-open': 'FolderOpen', 'row-open': 'ArrowUpRight',
  'file-edit': 'Edit', 'row-edit': 'Edit', 'file-copy': 'Copy', 'folder-copy': 'Copy', 'row-copy': 'Copy',
  'file-export': 'Download', 'row-export': 'Download', 'row-select': 'SelectText', 'row-search': 'Search',
  'folder-new': 'Plus', 'close-tabs': 'CloseBold', 'open-tabs': 'Plus', 'open-window': 'ExternalLink',
  'row-together': 'Cube', 'row-poses': 'CompareArrows', 'row-new-tab': 'Plus', 'open-right': 'OpenRight', 'row-right-panel': 'OpenRight', 'open-as': 'Grid', 'open-3d': 'Cube',
  'open-together': 'Cube', 'open-poses': 'CompareArrows', 'open-aligned': 'CompareArrows', 'open-table': 'TableFilled',
  'open-cards': 'Grid', 'open-text': 'Text', 'open-finder': 'FolderDocumentsFinder', 'folder-finder': 'FolderDocumentsFinder',
  'open-external': 'ExternalLink', 'open-default-app': 'ExternalLink', 'open-folder': 'FolderOpen',
  'rename-scene': 'Edit', 'rename-file': 'Edit', 'rename-folder': 'Edit', 'rename-project': 'Edit', 'edit-ketcher': 'Edit',
  'duplicate-file': 'Copy', 'copy-names': 'Text', 'copy-paths': 'Link', 'copy-folder-name': 'Text', 'copy-folder-path': 'Link',
  'save-file-copy': 'Download', 'save-scene': 'Download', 'export-table': 'Download', 'trash-file': 'Trash', 'trash-folder': 'Trash',
  'new-folder': 'FolderPlus', 'new-molecule': 'Plus', 'refresh-folder': 'ArrowRotateCw', 'remove-project': 'CloseBold',
  'show-tab-in-sidebar': 'Sidebar', 'close-tab': 'CloseBold', 'close-other-tabs': 'CloseBold', 'close-tabs-right': 'CloseBold',
  'close-all-tabs': 'CloseBold', 'close-selected': 'CloseBold', 'open-files': 'FolderOpen', 'add-project': 'FolderPlus',
  'recent-files': 'ArrowRotateCw', 'expand-all-projects': 'Plus', 'collapse-all-projects': 'CloseBold',
  'open': 'Search', 'molstar': 'Cube', 'selected-molstar': 'Cube', 'ketcher': 'Edit', 'duplicate': 'Copy',
  'copy': 'Copy', 'copy-name': 'Text', 'copy-cell': 'Copy', 'copy-smiles': 'Link', 'copy-selected': 'Copy',
  'export': 'Download', 'export-selected': 'Download', 'export-selected-smiles': 'Download',
  'select-row': 'SelectText', 'select-all': 'SelectText', 'clear-selection': 'CloseBold',
  'pubchem-identity': 'Search', 'pubchem-similarity': 'Search', 'filter-cell': 'Search', 'remove': 'Trash',
};

export function withMenuIcons(entries: MenuItemSpec[]): MenuItemSpec[] {
  return entries.map(entry => {
    if (entry.kind !== "item" && entry.kind !== "submenu") return entry;
    let name = names[entry.id];
    if (entry.id.startsWith('open-editor-')) name = 'ExternalLink';
    if (entry.id.startsWith('export-')) name = 'Download';
    if (entry.id === 'export-image') name = 'ImageSquare';
    if (entry.id === 'copy-inchi') name = 'Link';
    if (entry.id === 'copy-sequence') name = 'Text';
    if (entry.id.startsWith('pin-') || entry.id.startsWith('unpin-')) name = entry.text.startsWith('Unpin') ? 'Unpin' : 'Pin';
    if (entry.id.startsWith('add-scene') || entry.id.startsWith('row-scene') || entry.id === 'row-add-scene') name = 'Cube';
    const iconUrl = urls[aliases[name] ?? name ?? entry.icon ?? ""] ?? entry.iconUrl;
    return { ...entry, ...(iconUrl ? { iconUrl } : {}), ...(entry.kind === "submenu" ? { items: withMenuIcons(entry.items) } : {}) };
  });
}

const nativeImages = new Map<string, Promise<string>>();
export function nativeMenuImage(url: string): Promise<string> {
  let pending = nativeImages.get(url);
  if (!pending) {
    pending = new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('Menu icon rendering is unavailable.')); return; }
        context.drawImage(image, 0, 0, 32, 32);
        resolve(canvas.toDataURL('image/png').split(',')[1]);
      };
      image.onerror = () => { nativeImages.delete(url); reject(new Error('Could not load a menu icon.')); };
      image.src = url;
    });
    nativeImages.set(url, pending);
  }
  return pending;
}
