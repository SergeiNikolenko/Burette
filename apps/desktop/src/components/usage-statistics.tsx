import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { chooseUsageStatistics, flushUsageStatistics, recordStatisticsFeature, useUsageStatistics } from "../lib/usage-statistics";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import "../styles/usage-statistics.css";

function Disclosure({ noticeUrl }: { noticeUrl: string }) {
  return <p>
    Help Sergei Nikolenko improve Burette by sharing daily activity, feature use and error categories,
    with a random installation ID, app version and CPU architecture. No files, molecules, paths,
    typed text or error logs. Stored for 90 days. Optional; all features work without sharing.
    Turn off and delete shared data in Settings → General.
    {" "}<Button variant="link" size="sm" onClick={() => void openUrl(noticeUrl).catch(() => {})}>Privacy notice</Button>
  </p>;
}

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
  if (settings && !state.available && !state.pendingErasure) return <section className="usage-statistics-settings"><h2>Usage statistics</h2><p>Sharing is unavailable in this build.</p></section>;
  const exportData = async () => {
    const contents = await invoke<string>("statistics_export");
    const outputPath = await save({ defaultPath: "burette-statistics.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (outputPath) await invoke("write_text_file", { request: { outputPath, contents } });
  };
  return <section className={settings ? "usage-statistics-settings" : "usage-statistics-banner"} aria-label="Usage statistics">
    <h2>{settings ? "Usage statistics" : "Share usage statistics?"}</h2>
    {state.noticeUrl && <Disclosure noticeUrl={state.noticeUrl} />}
    <div className="usage-statistics-actions">
      {settings ? <>
        <label className="usage-statistics-toggle">Share usage statistics
          <Switch aria-label="Share usage statistics" tone="neutral" checked={state.enabled}
            disabled={busy || !state.available || state.pendingErasure}
            onCheckedChange={enabled => void perform(() => chooseUsageStatistics(enabled))} />
        </label>
        {state.enabled && <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(exportData)}>Export my statistics</Button>}
      </> : <>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => chooseUsageStatistics(false))}>Don’t share</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => chooseUsageStatistics(true))}>Share statistics</Button>
      </>}
      {state.pendingErasure && <><span role="status">Sharing is off. Deletion is pending a connection.</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(flushUsageStatistics)}>Retry deletion</Button></>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
