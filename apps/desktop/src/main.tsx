import "./performance-start";
import "./lib/browser-node-globals";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { installKetcherBrowserRequire } from "./lib/ketcher-browser-require";
import { markPerformanceOnce } from "./lib/performance";
import { initializeWebDemoAnalytics } from "./lib/web-demo-analytics";
import "./styles.css";

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

if (import.meta.env.VITE_BURRETE_WEB_DEMO === "1") {
  void initializeWebDemoAnalytics().catch((error) => {
    console.error("[Web demo analytics] Initialization failed", error);
  });
}
createRoot(document.getElementById("root")!).render(
  <Root />,
);
