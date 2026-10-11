import { Component, type ErrorInfo, type ReactNode } from "react";
import { trackWebDemoHandledError } from "../lib/web-demo-analytics";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../lib/theme";
import { useSettingsStore } from "../stores/settings-store";
import { Warning } from "./ui/app-icons";
import { PanelEmptyState } from "./ui/panel-empty-state";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    trackWebDemoHandledError(error, "React render failed");
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <RecoveryScreen onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

// The root boundary lives outside App, so it cannot inherit the failed shell's
// theme. Read the same preferences and host/system theme, without mounting App.
function RecoveryScreen({ onRetry }: { onRetry: () => void }) {
  const preferences = useSettingsStore(state => state.preferences);
  const systemTheme = useSystemThemeMode();
  const mode = resolveThemeMode(preferences.theme, systemTheme);
  return <div className={`app-shell error-boundary ${mode === "dark" ? "dark" : ""}`}
    data-theme={preferences.theme} data-effective-theme={mode} style={buildThemeStyle(preferences, systemTheme)} role="alert">
    <PanelEmptyState title="Something went wrong" icon={<Warning />} action={{ label: "Try again", run: onRetry }} />
  </div>;
}
