import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeWorkspaceHome } from "@/components/welcome/native-workspace-home";
import type { NativeWorkspaceHome as HomeBridge } from "@/lib/native-mcp-workspace";
import type { ShellActions } from "@/components/types";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { buildThemeStyle, type ThemeMode } from "@/lib/theme";
import { defaultPreferences } from "@/stores/settings-store";
import "../src/styles.css";
import "../src/styles/codex-tokens.css";
import "../src/styles/interface-tokens.css";

// Real home UI, with in-memory host callbacks. No filesystem or chat operations.
function HomeExample({ scenario }: { scenario: string }) {
  const [selected, setSelected] = useState("");
  const [home] = useState<HomeBridge>(() => {
    let attempts = 0;
    return {
      recent: async () => {
        if (scenario === "empty") return [];
        if (scenario === "unavailable" && attempts++ === 0) throw new Error("History unavailable");
        return [
          { path: "/cache/burette-pdb-entries/4HHB.pdb", label: "4HHB.pdb", format: "pdb", openedAt: new Date(Date.now() - 180000).toISOString() },
          { path: "/Projects/Kinase/Series A.sdf", label: "Series A.sdf", format: "sdf", openedAt: new Date(Date.now() - 7200000).toISOString() },
          { path: "/Projects/Kinase/Activity.csv", label: "Activity.csv", format: "csv", openedAt: new Date(Date.now() - 86400000).toISOString() },
        ];
      },
      open: async link => { setSelected(new URL(link, "https://example.test").searchParams.get("path")?.split("/").pop() ?? ""); },
      search: async () => [], ask: async () => {},
    };
  });
  return <>
    <NativeWorkspaceHome home={home} actions={{ openKetcher: () => setSelected("Ketcher") } as ShellActions} />
    {selected ? <output className="mx-auto pb-6 text-sm">{selected}</output> : null}
  </>;
}
function Preview() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [scenario, setScenario] = useState("recent");
  return <main className={`app-shell flex flex-col ${theme === "dark" ? "dark" : ""}`} data-runtime="browser" data-theme={theme} data-effective-theme={theme}
    style={{ ...buildThemeStyle({ ...defaultPreferences, theme }, theme), background: "var(--surface-primary)" }}>
    <div className="flex items-center justify-end gap-2 px-5 pt-5">
      <NativeSelect aria-label="Recent files state" value={scenario} onChange={event => setScenario(event.target.value)}>
        <NativeSelectOption value="recent">Recent files</NativeSelectOption><NativeSelectOption value="empty">No recent files</NativeSelectOption><NativeSelectOption value="unavailable">Unavailable</NativeSelectOption>
      </NativeSelect>
      <Button variant="secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Dark" : "Light"}</Button>
    </div>
    <HomeExample key={scenario} scenario={scenario} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
