import { useState } from "react";
import type { MenuItemSpec } from "../menu-types";

export type ProjectOrganization = "project" | "connection" | "flat";
export type ProjectSort = "manual" | "priority" | "recent";
const key = "burette.project-organization.v1";
export function useProjectOrganization() {
  const [options, setOptions] = useState<{ organization: ProjectOrganization; sort: ProjectSort }>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "{}");
      return { organization: ["project", "connection", "flat"].includes(value.organization) ? value.organization : "project", sort: ["manual", "priority", "recent"].includes(value.sort) ? value.sort : "manual" };
    } catch { return { organization: "project", sort: "manual" }; }
  });
  const update = (patch: Partial<typeof options>) => setOptions(previous => { const next = { ...previous, ...patch }; localStorage.setItem(key, JSON.stringify(next)); return next; });
  const items: MenuItemSpec[] = [
    { kind: "submenu", id: "organize", text: "Organize sidebar", items: ([["project", "By project"], ["connection", "By connection"], ["flat", "In one list"]] as const).map(([value, text]) => ({ kind: "checkbox", id: value, text, checked: options.organization === value, action: () => update({ organization: value }) })) },
    { kind: "submenu", id: "sort", text: "Sort projects by", items: ([["priority", "Priority"], ["recent", "Last opened"], ["manual", "Manual order"]] as const).map(([value, text]) => ({ kind: "checkbox", id: value, text, checked: options.sort === value, action: () => update({ sort: value }) })) },
  ];
  return { ...options, items };
}
