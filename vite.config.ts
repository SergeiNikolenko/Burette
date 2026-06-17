import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const desktopDist = fileURLToPath(new URL("apps/desktop/dist", import.meta.url));
const extraFsAllow = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);

export default defineConfig({
  plugins: lazyPlugins(async () => {
    const [{ default: react }, { browserDevXyzrenderPlugin }] = await Promise.all([
      import("@vitejs/plugin-react"),
      import("./apps/desktop/vite.config"),
    ]);
    return [react(), browserDevXyzrenderPlugin()];
  }),
  define: {
    "import.meta.env.BURRETE_REPO_ROOT": JSON.stringify(repoRoot),
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
  fmt: {
    ignorePatterns: [
      ".github/**",
      ".thoughts/**",
      "AGENTS.md",
      "DESIGN.md",
      "PRODUCT.md",
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
    include: ["tests/vp-contract.test.mjs"],
    globals: true,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
