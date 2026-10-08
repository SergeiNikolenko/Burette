import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const contractScripts = {
  "test-ketcher-persist-prompt.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-ketcher-persist-prompt.test.tsx", import.meta.url))]),
  "test-appearance-theme.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-appearance-theme.test.tsx", import.meta.url))]),
  "test-tab-memory-router.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-tab-memory-router.test.tsx", import.meta.url))]),
  "test-chemical-editor-query.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-chemical-editor-query.test.tsx", import.meta.url))]),
  "test-settings-sidebar.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-settings-sidebar.test.tsx", import.meta.url))]),
  "test-dock-header.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-dock-header.test.tsx", import.meta.url))]),
  "test-welcome-screen.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-welcome-screen.test.tsx", import.meta.url))]),
  "test-inspector-tool-row.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-inspector-tool-row.test.tsx", import.meta.url))]),
  "test-settings-controls.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-settings-controls.test.tsx", import.meta.url))]),
  "test-browser-select.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-browser-select.test.tsx", import.meta.url))]),
  "test-toast-interactions.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-toast-interactions.test.tsx", import.meta.url))]),
  "test-input-fields.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-input-fields.test.tsx", import.meta.url))]),
  "test-overlay-interactions.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-overlay-interactions.test.tsx", import.meta.url))]),
  "test-file-operation-dialogs.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-file-operation-dialogs.test.tsx", import.meta.url))]),
  "test-button-interactions.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-button-interactions.test.tsx", import.meta.url))]),
  "test-selection-controls.test.tsx": () => promisify(execFile)("bun", ["test", fileURLToPath(new URL("./test-selection-controls.test.tsx", import.meta.url))]),
  "test-startup-runtime-refresh.mjs": () => promisify(execFile)("bun", [fileURLToPath(new URL("./test-startup-runtime-refresh.mjs", import.meta.url))]),
  "test-pose-camera-stability.mjs": () => import("./test-pose-camera-stability.mjs"),
  "test-collection-analysis-menu.mjs": () => import("./test-collection-analysis-menu.mjs"),
  "test-conformer-collection.mjs": () => import("./test-conformer-collection.mjs"),
  "test-burette-deep-links.mjs": () => import("./test-burette-deep-links.mjs"),
  "test-ketcher-import-readiness.mjs": () => import("./test-ketcher-import-readiness.mjs"),
  "test-renderer-view-state.mjs": () => import("./test-renderer-view-state.mjs"),
  "test-json-display.mjs": () => import("./test-json-display.mjs"),
  "test-standalone-conformer-jobs.mjs": () => import("./test-standalone-conformer-jobs.mjs"),
  "test-grid-conformer-metal.mjs": () => import("./test-grid-conformer-metal.mjs"),
  // The settings migration deliberately boots Zustand with legacy localStorage.
  "test-settings-engine-migration.mjs": () => promisify(execFile)(process.execPath, [fileURLToPath(new URL("./test-settings-engine-migration.mjs", import.meta.url))]),
  "test-browser-file-actions.mjs": () => import("./test-browser-file-actions.mjs"),
  "test-workspace-export-guards.mjs": () => import("./test-workspace-export-guards.mjs"),
  "test-workspace-file-menu.mjs": () => import("./test-workspace-file-menu.mjs"),
  "test-scene-file-actions.mjs": () => import("./test-scene-file-actions.mjs"),
  "test-native-viewer-menus.mjs": () => import("./test-native-viewer-menus.mjs"),
  "test-native-context-menu.mjs": () => import("./test-native-context-menu.mjs"),
  "test-molecule-preview-interactions.mjs": () => import("./test-molecule-preview-interactions.mjs"),
  "test-expanded-context-menus.mjs": () => import("./test-expanded-context-menus.mjs"),
  "test-color-picker.mjs": () => import("./test-color-picker.mjs"),
  "test-molstar-context-environment.mjs": () => import("./test-molstar-context-environment.mjs"),
  "test-chemical-space-settings.mjs": () => import("./test-chemical-space-settings.mjs"),
  "test-chemical-space-grid-navigation.mjs": () => import("./test-chemical-space-grid-navigation.mjs"),
  "test-burette-agent.mjs": () => import("./test-burette-agent.mjs"),
  "test-agent-preview-server.mjs": () => import("./test-agent-preview-server.mjs"),
  "test-update-versioning.mjs": () => import("./test-update-versioning.mjs"),
  "test-bun-installer-behavior.mjs": () => import("./test-bun-installer-behavior.mjs"),
  "test-install-health-contract.mjs": () => import("./test-install-health-contract.mjs"),
  "test-preview-format-matrix.mjs": () => import("./test-preview-format-matrix.mjs"),
  "test-cross-platform-preview-contract.mjs": () => import("./test-cross-platform-preview-contract.mjs"),
  "test-sidebar-projects.mjs": () => import("./test-sidebar-projects.mjs"),
  "test-sidebar-tree-render.mjs": () => promisify(execFile)("bun", [fileURLToPath(new URL("./test-sidebar-tree-render.mjs", import.meta.url))]),
  "test-docking-documents.mjs": () => import("./test-docking-documents.mjs"),
  "test-ui-shell-contract.mjs": () => import("./test-ui-shell-contract.mjs"),
  "test-molstar-style-switch.mjs": () => import("./test-molstar-style-switch.mjs"),
  "test-molstar-label-theme.mjs": () => promisify(execFile)("bun", ["--preload", fileURLToPath(new URL("./fixtures/molstar-state-preload.mjs", import.meta.url)), fileURLToPath(new URL("./test-molstar-label-theme.mjs", import.meta.url))]),
  "test-molstar-measurement-picks.mjs": () => promisify(execFile)("bun", ["--preload", fileURLToPath(new URL("./fixtures/molstar-state-preload.mjs", import.meta.url)), fileURLToPath(new URL("./test-molstar-measurement-picks.mjs", import.meta.url))]),
  "test-molstar-preset-preview-controller.mjs": () => import("./test-molstar-preset-preview-controller.mjs"),
  "test-collection-documents.mjs": () => import("./test-collection-documents.mjs"),
  "test-structure-drag.mjs": () => import("./test-structure-drag.mjs"),
  "test-drop-feedback.mjs": () => import("./test-drop-feedback.mjs"),
  "test-drop-routing.mjs": () => import("./test-drop-routing.mjs"),
  "test-drop-actions.mjs": () => import("./test-drop-actions.mjs"),
  "test-molecule-store-behavior.mjs": () => import("./test-molecule-store-behavior.mjs"),
  "test-markdown-block-layout.mjs": () => import("./test-markdown-block-layout.mjs"),
  "test-text-find.mjs": () => import("./test-text-find.mjs"),
  // Mol* captures its scheduler globals on import; keep real DOM tests separate from store mocks.
  "test-mmcif-block-loading.mjs": () => promisify(execFile)(process.execPath, [fileURLToPath(new URL("./test-mmcif-block-loading.mjs", import.meta.url))]),
  "test-shell-store-behavior.mjs": () => import("./test-shell-store-behavior.mjs"),
  "test-fep-setup-store.mjs": () => import("./test-fep-setup-store.mjs"),
  "test-tauri-structure.mjs": () => import("./test-tauri-structure.mjs"),
};

describe("Burette contract scripts", () => {
  for (const [script, runScript] of Object.entries(contractScripts)) {
    test(script, async () => {
      await runScript();
    });
  }
});
