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

// The SDK foundation and its global reset belong only to the MCP document.
// Keep them out of native desktop and ordinary Browser-preview styles.
const NativeWorkspacePlacementControl = React.lazy(() => import("./components/native-workspace-placement-control")
  .then((module) => ({ default: module.NativeWorkspacePlacementControl })));

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
  // The preview root is inert until the molecular scene is ready. Host controls
  // need their own React root so their event handlers remain usable meanwhile.
  const controlHost = window.BuretteMcpWorkspace ? document.createElement("div") : null;
  if (controlHost) {
    controlHost.dataset.workspacePlacementHost = "";
    document.body.appendChild(controlHost);
  }
  const controlsRoot = controlHost ? createRoot(controlHost) : null;
  if (window.BuretteMcpWorkspace) window.BuretteMcpWorkspace.unmount = () => {
    controlsRoot?.unmount();
    controlHost?.remove();
    root.unmount();
  };
  root.render(<Root />);
  controlsRoot?.render(
    <React.StrictMode>
      <ErrorBoundary>
        <React.Suspense fallback={null}>
          <NativeWorkspacePlacementControl />
        </React.Suspense>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
