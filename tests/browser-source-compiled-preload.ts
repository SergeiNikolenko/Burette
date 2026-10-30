import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";

plugin({ name: "browser-source-recovery-compiler", setup(build) {
  build.onLoad({ filter: /apps\/desktop\/src\/hooks\/use-(?:app-file-open|app-startup-effects|browser-session-restore|source-editing|browser-source-recovery)\.ts$/u }, ({ path }) => {
    const code = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })?.code;
    if (!code) throw new Error(`Compiler pass returned no source: ${path}`);
    // Keep the app default: unsupported hooks may remain unoptimized; never force compilation.
    process.stderr.write(JSON.stringify({ hook: path.split("/").pop(), cacheEmitted: code.includes("react/compiler-runtime") }) + "\n");
    return { contents: code, loader: "ts" };
  });
} });
