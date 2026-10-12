import type { ComponentType } from "react";
import { Atom, BarChart, Chart, FileCode, FileDocument, FileImage, FileSpreadsheet, FolderOpen, Grid, SettingsCog, Lightbulb, Stopwatch } from "../ui/app-icons";
import type { GuideId } from "./guides";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const icons: Record<GuideId, Icon> = {
  launcher: Atom, file: Atom, grid: Grid, mesoscale: Grid, illustration: FileImage,
  spectrum: BarChart, ketcher: Atom, "text-file": FileCode, document: FileDocument,
  "chemical-space": Chart, "pose-review": Atom, "fep-setup": FileSpreadsheet,
  "fep-network": Chart, jobs: Stopwatch, settings: SettingsCog, agent: Lightbulb,
};

// The education-dialog hero is a separate, spacious surface above its content.
// These are the same scientific/navigation glyphs used by the real workspace.
export function GuideVisual({ screen }: { screen: GuideId | "appearance" | "start" }) {
  const Icon = screen === "appearance" ? SettingsCog : screen === "start" ? FolderOpen : icons[screen];
  return <div className="flex min-h-40 items-center justify-center gap-8 bg-(--color-background-primary-soft-alpha) px-8 py-8 sm:min-h-48" aria-hidden>
    {screen === "launcher" ? <>
      <FileDocument className="size-10 text-(--color-text-tertiary)" />
      <Atom className="size-24 text-(--color-text)" />
      <Grid className="size-10 text-(--color-text-tertiary)" />
    </> : <Icon className="size-24 text-(--color-text)" />}
  </div>;
}
