import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const desktopRoot = fileURLToPath(new URL("apps/desktop", import.meta.url));
const desktopDist = fileURLToPath(new URL("apps/desktop/dist", import.meta.url));
const vpContractTest = fileURLToPath(new URL("tests/vp-contract.test.mjs", import.meta.url));
const extraFsAllow = (process.env.BURETTE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);

export default defineConfig({
  root: desktopRoot,
  plugins: lazyPlugins(async () => {
    // Keep dev, native builds and plugin builds on the same renderer adapters.
    const { default: desktopConfig } = await import("./apps/desktop/vite.config");
    return desktopConfig.plugins ?? [];
  }),
  define: {
    global: "globalThis",
    process: JSON.stringify({ env: {} }),
    "process.env": "{}",
    "import.meta.env.BURETTE_REPO_ROOT": JSON.stringify(repoRoot),
  },
  // Plain `vite` does not read tsconfig `paths`, so the shadcn-style `@/` imports
  // only resolved under the desktop config's alias. Mirror it here for the
  // browser-dev flow that runs this root config directly.
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    alias: {
      "@": fileURLToPath(new URL("apps/desktop/src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [repoRoot, ...extraFsAllow] },
    watch: { ignored: ["apps/desktop/src-tauri/target/**"] },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
  },
  clearScreen: false,
  check: {
    fmt: false,
  },
  fmt: {
    ignorePatterns: [
      ".github/**",
      ".thoughts/**",
      "AGENTS.md",
      "PreviewExtension/**",
      "README.md",
      "THIRD_PARTY_NOTICES.md",
      "apps/**",
      "bun.lock",
      "config/**",
      "docs/**",
      "lefthook.yml",
      "package.json",
      "packages/**",
      "scripts/**",
      "tests/test-*.mjs",
      "tsconfig.json",
      "vendor-assets.lock.json",
      "*.html",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/target/**",
      "PreviewExtension/Web/molstar.js",
      "PreviewExtension/Web/mesoscale.js",
      "PreviewExtension/Web/grid-ui.js",
      "PreviewExtension/Web/sequence-panel.js",
      "PreviewExtension/Web/rdkit/**",
      "PreviewExtension/Web/rdkit-conformer/**",
      "PreviewExtension/Web/rdkit-compute/**",
      "PreviewExtension/Web/openchemlib/**",
      "plugins/burette-agent/browser-shell-dist/**",
      "plugins/burette-agent/preview-web/**",
      "plugins/burette-agent/mcp/lib/server-chunk-*.mjs",
      "plugins/burette-agent/scripts/mvs-schema-validator.mjs",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: [vpContractTest],
    globals: true,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
