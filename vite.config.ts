import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const desktopRoot = fileURLToPath(new URL("apps/desktop", import.meta.url));
const desktopDist = fileURLToPath(new URL("apps/desktop/dist", import.meta.url));
const vpContractTest = fileURLToPath(new URL("tests/vp-contract.test.mjs", import.meta.url));
const extraFsAllow = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);

export default defineConfig({
  root: desktopRoot,
  plugins: lazyPlugins(async () => {
    // tailwindcss must load here too: the desktop config carries it for native
    // builds, but browser dev runs through this root config, and without the
    // plugin every shadcn control (settings sliders, switches, selects) renders
    // unstyled — collapsed tracks, stray chevrons.
    const [{ default: react }, { browserDevXyzrenderPlugin }, { default: tailwindcss }] = await Promise.all([
      import("@vitejs/plugin-react"),
      import("./apps/desktop/vite.config"),
      import("@tailwindcss/vite"),
    ]);
    return [tailwindcss(), react(), browserDevXyzrenderPlugin()];
  }),
  define: {
    "import.meta.env.BURRETE_REPO_ROOT": JSON.stringify(repoRoot),
  },
  // Plain `vite` does not read tsconfig `paths`, so the shadcn-style `@/` imports
  // only resolved under the desktop config's alias. Mirror it here for the
  // browser-dev flow that runs this root config directly.
  resolve: {
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
      "PreviewExtension/Web/rdkit/**",
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
