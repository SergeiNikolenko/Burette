const contractScripts = {
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
  "test-collection-documents.mjs": () => import("./test-collection-documents.mjs"),
  "test-structure-drag.mjs": () => import("./test-structure-drag.mjs"),
  "test-drop-actions.mjs": () => import("./test-drop-actions.mjs"),
  "test-molecule-store-behavior.mjs": () => import("./test-molecule-store-behavior.mjs"),
  "test-shell-store-behavior.mjs": () => import("./test-shell-store-behavior.mjs"),
  "test-fep-setup-store.mjs": () => import("./test-fep-setup-store.mjs"),
  "test-tauri-structure.mjs": () => import("./test-tauri-structure.mjs"),
};

describe("Burrete contract scripts", () => {
  for (const [script, runScript] of Object.entries(contractScripts)) {
    test(script, async () => {
      await runScript();
    });
  }
});
