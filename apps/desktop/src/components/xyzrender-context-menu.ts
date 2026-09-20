import type { MenuItemSpec } from "./menu-types";

export type XyzrenderContextAction =
  | "canvas:select-all" | "canvas:duplicate" | "canvas:arrange" | "canvas:animate"
  | "view:hide" | "view:show-all" | "select:hide" | "view:isolate"
  | "save-format:svg" | "save-format:png" | "save-format:gif";

export function xyzrenderContextMenuItems(
  options: { label: string; hasSelection: boolean; hasHidden: boolean },
  run: (action: XyzrenderContextAction) => void,
): MenuItemSpec[] {
  const item = (id: XyzrenderContextAction, text: string): MenuItemSpec => ({
    kind: "item", id, text, action: () => run(id),
  });
  return [
    item("canvas:select-all", "Select All"),
    item("canvas:duplicate", "Duplicate"),
    item("canvas:arrange", "Arrange"),
    item("canvas:animate", "3D & Animation…"),
    { kind: "separator" },
    item("view:hide", "Hide structure"),
    ...(options.hasHidden ? [item("view:show-all", "Show hidden graphics")] : []),
    ...(options.hasSelection ? [{
      kind: "submenu" as const, id: "xyzrender-selection", text: "Selection", items: [
        item("select:hide", "Hide selected"), item("view:isolate", "Dim others"),
      ],
    }] : []),
    { kind: "separator" },
    { kind: "submenu", id: "xyzrender-export", text: "Export", items: [
      item("save-format:svg", "SVG…"), item("save-format:png", "PNG…"), item("save-format:gif", "GIF…"),
    ] },
  ];
}
