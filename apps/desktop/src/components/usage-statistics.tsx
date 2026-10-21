import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { chooseUsageStatistics, flushUsageStatistics, recordStatisticsFeature, useUsageStatistics } from "../lib/usage-statistics";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "./ui/alert";
import { SettingsSection, actionRow, type SettingRow } from "./settings-panel/setting-control";
import "../styles/usage-statistics.css";

const disclosure = "Help improve Burette: activity and error categories, a random ID, no files or text. Kept for 90 days; turn off to delete.";

export function UsageStatistics({ settings = false, pageKind, renderer }: { settings?: boolean; pageKind?: string; renderer?: string }) {
  const state = useUsageStatistics();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (settings || !state.enabled) return;
    // Screen categories, never titles, document paths or arbitrary interaction text.
    switch (pageKind) {
      case "file": recordStatisticsFeature(renderer === "grid2d" ? "table" : "structure"); break;
      case "document": case "text-file": recordStatisticsFeature("files"); break;
      case "chemical-space": recordStatisticsFeature("table"); break;
      case "ketcher": recordStatisticsFeature("editor"); break;
      case "pose-review": recordStatisticsFeature("docking"); break;
      case "jobs": case "fep-setup": case "fep-network": recordStatisticsFeature("compute"); break;
    }
  }, [settings, pageKind, renderer, state.enabled]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch { setError("Could not complete this request. Please try again."); }
    finally { setBusy(false); }
  };
  if (!settings && (!state.available || state.decided || state.pendingErasure)) return null;
  if (settings && !state.available && !state.pendingErasure) return null;
  const exportData = async () => {
    const contents = await invoke<string>("statistics_export");
    const outputPath = await save({ defaultPath: "burette-statistics.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (outputPath) await invoke("write_text_file", { request: { outputPath, contents } });
  };
  const privacy = () => state.noticeUrl ? openUrl(state.noticeUrl) : Promise.resolve();
  if (settings) {
    const rows: SettingRow[] = [{
      label: "Share usage statistics",
      description: disclosure,
      control: <Switch aria-label="Share usage statistics" tone="neutral" checked={state.enabled}
        disabled={busy || !state.available || state.pendingErasure}
        onCheckedChange={enabled => void perform(() => chooseUsageStatistics(enabled))} />,
    }];
    if (state.noticeUrl) rows.push(actionRow("Privacy", "", "View", () => void perform(privacy), busy));
    if (state.enabled) rows.push(actionRow("My statistics", "", "Export", () => void perform(exportData), busy));
    if (state.pendingErasure) rows.push({ label: "Deletion pending", control:
      <Button variant="outline" size="settings" disabled={busy} onClick={() => void perform(flushUsageStatistics)}>Retry deletion</Button> });
    return <>
      <SettingsSection title="Usage statistics" rows={rows} />
      {error && <p role="alert">{error}</p>}
    </>;
  }
  return <div className="usage-statistics-banner">
    <Alert role="region" aria-label="Usage statistics" className="text-sm">
      <AlertTitle>Share usage statistics?</AlertTitle>
      <AlertDescription>{disclosure}</AlertDescription>
      <AlertAction>
        {state.noticeUrl && <Button variant="ghost" size="sm" className="mr-auto" disabled={busy} onClick={() => void perform(privacy)}>Privacy</Button>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => chooseUsageStatistics(false))}>Don’t share</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => chooseUsageStatistics(true))}>Share</Button>
      </AlertAction>
      {error && <p role="alert">{error}</p>}
    </Alert>
  </div>;
}
