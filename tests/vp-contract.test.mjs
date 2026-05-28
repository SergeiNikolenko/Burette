const contractScripts = {
  "test-burette-agent.mjs": () => import("./test-burette-agent.mjs"),
  "test-agent-preview-server.mjs": () => import("./test-agent-preview-server.mjs"),
  "test-update-versioning.mjs": () => import("./test-update-versioning.mjs"),
  "test-bun-installer-structure.mjs": () => import("./test-bun-installer-structure.mjs"),
  "test-bun-installer-behavior.mjs": () => import("./test-bun-installer-behavior.mjs"),
  "test-sidebar-projects.mjs": () => import("./test-sidebar-projects.mjs"),
  "test-docking-documents.mjs": () => import("./test-docking-documents.mjs"),
  "test-docking-viewer-contract.mjs": () => import("./test-docking-viewer-contract.mjs"),
  "test-ui-shell-contract.mjs": () => import("./test-ui-shell-contract.mjs"),
  "test-tauri-structure.mjs": () => import("./test-tauri-structure.mjs"),
};

describe("Burrete contract scripts", () => {
  for (const [script, runScript] of Object.entries(contractScripts)) {
    test(script, async () => {
      await runScript();
    });
  }
});
