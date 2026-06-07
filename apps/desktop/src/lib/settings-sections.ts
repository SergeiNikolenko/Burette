export type SettingsSectionId =
  | "general"
  | "appearance"
  | "structure"
  | "updates"
  | "workspace"
  | "agent"
  | "maintenance";

export type SettingsNavItem = {
  id: SettingsSectionId;
  label: string;
  description: string;
};

export type SettingsNavGroup = {
  title: string;
  items: SettingsNavItem[];
};

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

export const settingsNavGroups: SettingsNavGroup[] = [
  {
    title: "Personal",
    items: [
      { id: "general", label: "General", description: "Workspace defaults and open documents" },
      { id: "appearance", label: "Appearance", description: "Theme, colors, and shell presentation" },
      { id: "structure", label: "Structure rendering", description: "Mol* and renderer defaults" },
      { id: "updates", label: "Updates", description: "Release checks and install channel" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { id: "workspace", label: "Files and projects", description: "Recent structures and project folders" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { id: "agent", label: "Burrete", description: "Codex plugin bundle and capability checks" },
    ],
  },
  {
    title: "System",
    items: [
      { id: "maintenance", label: "Maintenance", description: "Quick Look, logs, diagnostics, and cache" },
    ],
  },
];

const settingsSectionIds = new Set<SettingsSectionId>(
  settingsNavGroups.flatMap((group) => group.items.map((item) => item.id)),
);

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  return typeof value === "string" && settingsSectionIds.has(value as SettingsSectionId)
    ? value as SettingsSectionId
    : DEFAULT_SETTINGS_SECTION;
}

export function settingsSectionLabel(section: SettingsSectionId) {
  for (const group of settingsNavGroups) {
    const item = group.items.find((candidate) => candidate.id === section);
    if (item) return item.label;
  }
  return "Settings";
}
