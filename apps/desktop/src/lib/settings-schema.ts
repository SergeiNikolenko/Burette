import type { ViewerPreferences } from "../types";
import settingsSchema from "../../shared/settings.schema.json";

export type ThemeMode = "light" | "dark";
export type SettingKey = keyof ViewerPreferences;
export type SettingsMap = ViewerPreferences;

export interface SettingDef {
  key: SettingKey;
  label: string;
  description: string;
  category: "appearance" | "renderer";
  type: "enum" | "theme-overrides";
  options?: string[];
  default: ViewerPreferences[SettingKey];
}

export const SETTINGS_SCHEMA = settingsSchema.settings as SettingDef[];

export function getSettingsByCategory(category: SettingDef["category"]) {
  return SETTINGS_SCHEMA.filter((definition) => definition.category === category);
}

export function getSettingDef(key: SettingKey) {
  return SETTINGS_SCHEMA.find((definition) => definition.key === key) ?? null;
}
