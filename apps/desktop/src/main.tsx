import "./performance-start";
import "./lib/browser-node-globals";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { markPerformanceOnce } from "./lib/performance";
import "./styles.css";

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

createRoot(document.getElementById("root")!).render(
  <Root />,
);
