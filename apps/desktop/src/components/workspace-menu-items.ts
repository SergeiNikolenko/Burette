import { isMolstarSceneImportSource } from "../lib/docking-documents";
import previewFormatRegistry from "../../../../config/preview-formats.json";
import type { MenuItemSpec } from "./menu-types";

export function menuItem(id: string, text: string, action: () => unknown | Promise<unknown>): MenuItemSpec {
  return { kind: "item", id, text, action };
}
export function submenu(id: string, text: string, items: MenuItemSpec[], nativeSymbol?: string): MenuItemSpec[] {
  return items.length ? [{ kind: "submenu", id, text, items, nativeSymbol }] : [];
}
export function menuSections(...sections: MenuItemSpec[][]): MenuItemSpec[] {
  const items = sections.filter(section => section.length).flatMap((section, index) =>
    index ? [{ kind: "separator" } as MenuItemSpec, ...section] : section);
  return items.filter((entry, index) => entry.kind !== "separator" || (index > 0 && index < items.length - 1 && items[index - 1].kind !== "separator"));
}
export function fileCapabilities(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const format = previewFormatRegistry.formats.find(format => format.extensions.includes(extension));
  return {
    xyzrender: format?.preview?.capabilities?.canSwitchRenderer === true,
    scene: isMolstarSceneImportSource(path),
    molecule: ['mol', 'mol2', 'sdf', 'smi', 'smiles', 'cxsmiles'].includes(extension),
    poses: ['mol', 'sdf'].includes(extension),
    collection: ['sdf', 'sd', 'smi', 'smiles', 'csv', 'tsv'].includes(extension),
    text: !['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'dcd', 'xtc', 'trr', 'mrc', 'ccp4', 'bcif'].includes(extension),
    protein: ['pdb', 'cif', 'mmcif'].includes(extension),
    extension,
  };
}
