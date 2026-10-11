import type { ViewerPreferences } from "../../types";
import { defaultPreferences } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import { SettingsSection, ToggleControl, selectPreferenceRow, type SettingRow } from "./setting-control";

type SetPreference = ShellActions["setPreference"];
type ChoiceKey = "screenshotResolution" | "screenshotFormat" | "gridViewMode" | "gridCardRenderer" | "hydrogenDisplay";
type ToggleKey = "screenshotTransparent" | "quickLookGridSdf" | "quickLookGridSmiles" | "quickLookGridCsv" | "quickLookGridTsv";

const RESOLUTION_LABELS: Record<ViewerPreferences["screenshotResolution"], string> = {
  viewport: "Viewport",
  hd: "HD",
  "full-hd": "Full HD",
  "ultra-hd": "Ultra HD",
  "8k-ultra-hd": "8K",
};
const FORMAT_LABELS: Record<ViewerPreferences["screenshotFormat"], string> = { png: "PNG", jpeg: "JPEG", webp: "WebP" };
const VIEW_LABELS: Record<ViewerPreferences["gridViewMode"], string> = { cards: "Cards", table: "Table" };
const CARD_DRAWING_LABELS: Record<ViewerPreferences["gridCardRenderer"], string> = { rdkit: "2D drawing", xyzrender: "3D render" };
const HYDROGEN_LABELS: Record<ViewerPreferences["hydrogenDisplay"], string> = { none: "Hidden", all: "Shown" };
// 0 keeps the fluid card width; the rest are fixed minimum widths in px.
const CARD_SIZE_LABELS: Record<number, string> = { 0: "Auto", 120: "Small", 174: "Medium", 240: "Large" };

function choiceRow<K extends ChoiceKey>(
  label: string,
  key: K,
  labels: Record<ViewerPreferences[K], string>,
  preferences: ViewerPreferences,
  setPreference: SetPreference,
): SettingRow {
  return selectPreferenceRow(
    label,
    "",
    preferences[key],
    Object.keys(labels),
    defaultPreferences[key],
    (value) => setPreference(key, value as ViewerPreferences[K]),
    labels,
  );
}

function toggleRow(label: string, key: ToggleKey, preferences: ViewerPreferences, setPreference: SetPreference): SettingRow {
  return {
    label,
    control: <ToggleControl label={label} checked={preferences[key]} onChange={(checked) => setPreference(key, checked)} />,
    reset: () => setPreference(key, defaultPreferences[key]),
    isModified: preferences[key] !== defaultPreferences[key],
  };
}

function cardSizeRow(preferences: ViewerPreferences, setPreference: SetPreference): SettingRow {
  const value = preferences.gridCardSize;
  const labels: Record<string, string> = { ...CARD_SIZE_LABELS };
  if (!(value in labels)) labels[value] = `${value} px`;
  const options = Object.keys(labels).sort((a, b) => Number(a) - Number(b));
  return selectPreferenceRow(
    "Card size",
    "",
    String(value),
    options,
    String(defaultPreferences.gridCardSize),
    (next) => setPreference("gridCardSize", Number(next)),
    labels,
  );
}

export function ViewerDefaultsSection({
  preferences,
  actions,
}: {
  preferences: ViewerPreferences;
  actions: Pick<ShellActions, "setPreference">;
}) {
  const setPreference = actions.setPreference;
  return (
    <>
      <SettingsSection
        title="Screenshots"
        rows={[
          choiceRow("Resolution", "screenshotResolution", RESOLUTION_LABELS, preferences, setPreference),
          choiceRow("Format", "screenshotFormat", FORMAT_LABELS, preferences, setPreference),
          toggleRow("Transparent background", "screenshotTransparent", preferences, setPreference),
        ]}
      />
      <SettingsSection
        title="Molecule grid"
        rows={[
          choiceRow("View", "gridViewMode", VIEW_LABELS, preferences, setPreference),
          choiceRow("Card drawing", "gridCardRenderer", CARD_DRAWING_LABELS, preferences, setPreference),
          cardSizeRow(preferences, setPreference),
          choiceRow("Hydrogens", "hydrogenDisplay", HYDROGEN_LABELS, preferences, setPreference),
        ]}
      />
      <SettingsSection
        title="Quick Look"
        rows={[
          toggleRow("SDF as grid", "quickLookGridSdf", preferences, setPreference),
          toggleRow("SMILES as grid", "quickLookGridSmiles", preferences, setPreference),
          toggleRow("CSV as grid", "quickLookGridCsv", preferences, setPreference),
          toggleRow("TSV as grid", "quickLookGridTsv", preferences, setPreference),
        ]}
      />
    </>
  );
}
