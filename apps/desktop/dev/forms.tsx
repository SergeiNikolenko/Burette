// Real production dialogs with in-memory outcomes: no filesystem or compute writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MergeColumnsDialog } from "@/components/merge-columns-dialog";
import { CalculatedColumnDialog } from "@/components/calculated-column-dialog";
import type { GridColumnChoice } from "@/components/types";
import { JobExamples } from "./job-examples";
import { ConnectionExamples } from "./connection-examples";
import { MenuExamples } from "./menu-examples";
import { ToastExamples } from "./toast-examples";
import { OverlayExamples } from "./overlay-examples";
import { Button } from "@/components/ui/button";
import { buildThemeStyle, type ThemeMode } from "@/lib/theme";
import { defaultPreferences } from "@/stores/settings-store";
import "../src/styles.css";
import "../src/styles/codex-tokens.css";
import "../src/styles/interface-tokens.css";
import "../src/styles/dock-panels.css";

const columns: GridColumnChoice[] = [{ id: "mass", label: "Mass", type: "number", kind: "property" }, { id: "logp", label: "LogP", type: "number", kind: "property" }];
const request = { documentId: "series", documentTitle: "Series", columns };
function Forms() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [open, setOpen] = useState<"merge" | "calculate" | null>(null);
  const [result, setResult] = useState("");
  return <main className={`app-shell ${theme === "dark" ? "dark" : ""}`} data-theme={theme} data-effective-theme={theme}
    style={{ ...buildThemeStyle({ ...defaultPreferences, theme }, theme), display: "flex", flexDirection: "column", gap: 16, padding: 32, overflowY: "auto" }}>
    <h1>Series</h1>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <Button variant="secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Dark" : "Light"}</Button>
      <Button onClick={() => setOpen("merge")}>Merge columns</Button>
      <Button onClick={() => setOpen("calculate")}>Calculated values</Button>
      <OverlayExamples />
      <ToastExamples />
      <MenuExamples />
    </div>
    <JobExamples />
    <ConnectionExamples />
    {result ? <output>{result}</output> : null}
    <MergeColumnsDialog request={open === "merge" ? request : null} onDismiss={() => setOpen(null)}
      onRun={(_id, label, separator, selected) => setResult(`${label}: ${selected.map(c => c.label).join(separator)}`)} />
    <CalculatedColumnDialog request={open === "calculate" ? request : null} onDismiss={() => setOpen(null)}
      onRun={(_id, label, formula) => { setResult(`${label} = ${formula}`); setOpen(null); }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Forms />);
