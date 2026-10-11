// Exercise the real root boundary without breaking a molecular workspace.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "@/lib/theme";
import { useSettingsStore } from "@/stores/settings-store";
import "../src/styles.css";
import "../src/styles/codex-tokens.css";
import "../src/styles/interface-tokens.css";

function RecoveryExample() {
  const [failed, setFailed] = useState(false);
  const preferences = useSettingsStore(state => state.preferences);
  const systemTheme = useSystemThemeMode();
  const mode = resolveThemeMode(preferences.theme, systemTheme);
  if (failed) throw new Error("Recovery example: simulated render failure");
  return <main className="app-shell error-boundary" data-theme={preferences.theme} data-effective-theme={mode}
    style={{ ...buildThemeStyle(preferences, systemTheme), gap: 12 }}>
    <Button onClick={() => setFailed(true)}>Test recovery</Button>
    <Button variant="secondary" onClick={() => useSettingsStore.getState().setPreference("theme", mode === "light" ? "dark" : "light")}>{mode === "light" ? "Dark" : "Light"}</Button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ErrorBoundary><RecoveryExample /></ErrorBoundary>);
