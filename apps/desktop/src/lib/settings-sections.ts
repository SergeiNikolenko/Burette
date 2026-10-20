export type SettingsSectionId =
  | "general"
  | "appearance"
  | "keyboard"
  | "structure"
  | "updates"
  | "workspace"
  | "jobs"
  | "xtb"
  | "connections"
  | "agent"
  | "maintenance";

export type AppSettingsSectionId = SettingsSectionId;

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
      { id: "keyboard", label: "Keyboard shortcuts", description: "Global app shortcuts and navigation keys" },
      { id: "structure", label: "Structure rendering", description: "Renderer defaults" },
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
    title: "Compute",
    items: [
      { id: "jobs", label: "Jobs", description: "Notifications, sleep, compute backend, history, and tool paths" },
      { id: "xtb", label: "xTB", description: "xTB runtime and calculation defaults" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { id: "connections", label: "Connections", description: "SSH machines and remote projects" },
      { id: "agent", label: "Agents", description: "Agent plugin status and diagnostics" },
    ],
  },
  {
    title: "System",
    items: [
      { id: "maintenance", label: "Maintenance", description: "Quick Look, logs, diagnostics, cache, and panel layout" },
    ],
  },
];

const settingsSectionIds = new Set<SettingsSectionId>(
  settingsNavGroups.flatMap((group) => group.items.map((item) => item.id)),
);

export function normalizeSettingsSection(value: unknown): AppSettingsSectionId {
  return typeof value === "string" && settingsSectionIds.has(value as SettingsSectionId)
    ? value as SettingsSectionId
    : DEFAULT_SETTINGS_SECTION;
}

export function settingsSectionLabel(section: AppSettingsSectionId) {
  for (const group of settingsNavGroups) {
    const item = group.items.find((candidate) => candidate.id === section);
    if (item) return item.label;
  }
  return "Settings";
}
