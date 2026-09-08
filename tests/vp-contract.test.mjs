import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const contractScripts = {
  "test-workspace-export-guards.mjs": () => import("./test-workspace-export-guards.mjs"),
  "test-workspace-file-menu.mjs": () => import("./test-workspace-file-menu.mjs"),
  "test-scene-file-actions.mjs": () => import("./test-scene-file-actions.mjs"),
  "test-native-context-menu.mjs": () => import("./test-native-context-menu.mjs"),
  "test-molecule-preview-interactions.mjs": () => import("./test-molecule-preview-interactions.mjs"),
  "test-expanded-context-menus.mjs": () => import("./test-expanded-context-menus.mjs"),
  "test-color-picker.mjs": () => import("./test-color-picker.mjs"),
  "test-molstar-context-environment.mjs": () => import("./test-molstar-context-environment.mjs"),
  "test-chemical-space-grid-navigation.mjs": () => import("./test-chemical-space-grid-navigation.mjs"),
  "test-burette-agent.mjs": () => import("./test-burette-agent.mjs"),
  "test-agent-preview-server.mjs": () => import("./test-agent-preview-server.mjs"),
  "test-update-versioning.mjs": () => import("./test-update-versioning.mjs"),
  "test-bun-installer-behavior.mjs": () => import("./test-bun-installer-behavior.mjs"),
  "test-install-health-contract.mjs": () => import("./test-install-health-contract.mjs"),
  "test-preview-format-matrix.mjs": () => import("./test-preview-format-matrix.mjs"),
  "test-cross-platform-preview-contract.mjs": () => import("./test-cross-platform-preview-contract.mjs"),
  "test-sidebar-projects.mjs": () => import("./test-sidebar-projects.mjs"),
  "test-docking-documents.mjs": () => import("./test-docking-documents.mjs"),
  "test-ui-shell-contract.mjs": () => import("./test-ui-shell-contract.mjs"),
  "test-molstar-preset-preview-controller.mjs": () => import("./test-molstar-preset-preview-controller.mjs"),
  "test-collection-documents.mjs": () => import("./test-collection-documents.mjs"),
  "test-structure-drag.mjs": () => import("./test-structure-drag.mjs"),
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
