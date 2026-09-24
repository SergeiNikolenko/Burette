import "./performance-start";
import "./lib/browser-node-globals";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { installFrontendErrorLog } from "./lib/frontend-error-log";
import { installKetcherBrowserRequire } from "./lib/ketcher-browser-require";
import { markPerformanceOnce } from "./lib/performance";
import { initializeWebDemoAnalytics } from "./lib/web-demo-analytics";
import "./styles.css";
import "./styles/interface-tokens.css";
import "./styles/inspector-panel.css";
import "./styles/dock-panels.css";
import "./styles/drop-feedback.css";

const NativeWorkspacePlacementControl = React.lazy(() => import("./components/native-workspace-placement-control")
  .then(module => ({ default: module.NativeWorkspacePlacementControl })));

installFrontendErrorLog();
installKetcherBrowserRequire();

function Root() {
  React.useEffect(() => {
    markPerformanceOnce("app:react-mounted");
  }, []);

  return (
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

if (import.meta.env.VITE_BURETTE_WEB_DEMO === "1") {
  void initializeWebDemoAnalytics().catch((error) => {
    console.error("[Web demo analytics] Initialization failed", error);
  });
}
if (!window.BuretteMcpWorkspace?.closed) {
  const root = createRoot(document.getElementById("root")!);
  // Keep host placement interactive while the molecular root is loading.
  const host = window.BuretteMcpWorkspace ? document.createElement("div") : null;
  if (host) {
    host.dataset.workspacePlacementHost = "";
    document.body.appendChild(host);
  }
  const controls = host ? createRoot(host) : null;
  if (window.BuretteMcpWorkspace) window.BuretteMcpWorkspace.unmount = () => {
    controls?.unmount();
    host?.remove();
    root.unmount();
  };
  root.render(<Root />);
  controls?.render(<React.StrictMode><ErrorBoundary><React.Suspense fallback={null}>
    <NativeWorkspacePlacementControl />
  </React.Suspense></ErrorBoundary></React.StrictMode>);
}
