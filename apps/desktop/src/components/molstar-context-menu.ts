import type { MenuItemSpec } from "./menu-types";

// The viewer owns the Mol* right-click menu: it knows the picked residue, the
// representation under it and which actions apply, so it sends the rows as data.
// The host only draws them. This parser checks shape and size and never trusts
// the frame for anything beyond text, icons and control ranges.
export type MolstarContextMenuSend = (id: string, value?: string | number | boolean) => void;

// The AppKit command's own bounds: 512 rows across the whole tree and three submenu
// levels. A choice becomes a submenu with one row per option, so it counts both.
const MAX_ENTRIES = 512;
const MAX_DEPTH = 3;
const MAX_ID = 160;
const MAX_TEXT = 200;
const MAX_ICON = 24 * 1024;
const MAX_OPTIONS = 80;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const text = (value: unknown, max = MAX_TEXT) => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function molstarContextMenuItems(entries: unknown, send: MolstarContextMenuSend): MenuItemSpec[] {
  let budget = MAX_ENTRIES;
  let labels = 0;
  const parse = (list: unknown, depth: number): MenuItemSpec[] => {
    if (!Array.isArray(list) || depth > MAX_DEPTH) return [];
    return list.flatMap((raw): MenuItemSpec[] => {
      if (--budget < 0 || !raw || typeof raw !== "object") return [];
      const entry = raw as Record<string, unknown>;
      if (entry.kind === "separator") return [{ kind: "separator" }];
      if (entry.kind === "label") {
        const caption = text(entry.text);
        return caption ? [{ kind: "label", id: `molstar-menu-label-${labels++}`, text: caption }] : [];
      }
      const key = text(entry.id, MAX_ID);
      if (!key) return [];
      // Prefixed so the shared icon and SF Symbol tables, keyed by host ids such as
      // `remove` or `molstar`, never restyle a row the viewer described.
      const id = `molstar-menu:${key}`;
      const icon = typeof entry.icon === "string" && entry.icon.startsWith("data:image/svg+xml") && entry.icon.length <= MAX_ICON
        ? { iconUrl: entry.icon } : {};
      if (entry.kind === "item") {
        const caption = text(entry.text);
        return caption ? [{ kind: "item", id, text: caption, ...icon, action: () => send(key) }] : [];
      }
      if (entry.kind === "checkbox") {
        const caption = text(entry.text);
        return caption ? [{ kind: "checkbox", id, text: caption, checked: entry.checked === true, action: (checked) => send(key, checked) }] : [];
      }
      if (entry.kind === "submenu") {
        const caption = text(entry.text);
        const items = parse(entry.items, depth + 1);
        return caption && items.length ? [{ kind: "submenu", id, text: caption, ...icon, items }] : [];
      }
      if (entry.kind === "select") {
        const label = text(entry.label);
        const options: string[] = [];
        const optionLabels: Record<string, string> = {};
        for (const option of Array.isArray(entry.options) ? entry.options.slice(0, MAX_OPTIONS) : []) {
          const value = text(option?.value, MAX_ID);
          if (value === null || value in optionLabels) continue;
          options.push(value);
          optionLabels[value] = text(option?.label) ?? value;
        }
        budget -= options.length;
        return label && options.length && depth < MAX_DEPTH && budget >= 0 ? [{
          kind: "select", id, label, value: typeof entry.value === "string" ? entry.value : "", options, optionLabels,
          action: (value) => send(key, value),
        }] : [];
      }
      if (entry.kind === "number") {
        const label = text(entry.label);
        const value = finite(entry.value);
        const min = finite(entry.min) ?? 0;
        const max = finite(entry.max) ?? Math.max(min + 1, value ?? 0);
        if (!label || value === null || max <= min) return [];
        const step = finite(entry.step);
        const unit = text(entry.unit, 8);
        return [{
          kind: "number", id, label, value: Math.min(max, Math.max(min, value)), min, max,
          ...(step !== null && step >= 0 ? { step } : {}), ...(unit ? { unit } : {}),
          action: (next) => send(key, next),
        }];
      }
      if (entry.kind === "swatches") {
        const colors = Array.isArray(entry.colors)
          ? entry.colors.filter((colour): colour is string => typeof colour === "string" && HEX_COLOUR.test(colour)).slice(0, 24)
          : [];
        const active = typeof entry.active === "string" && HEX_COLOUR.test(entry.active) ? { activeColor: entry.active } : {};
        return colors.length ? [{ kind: "swatches", id, colors, ...active, action: (colour) => send(key, colour) }] : [];
      }
      return [];
    });
  };
  return parse(entries, 0);
}
