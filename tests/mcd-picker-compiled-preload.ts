import "./browser-source-compiled-preload";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "mcd-picker-owner-compiler", setup(build) {
  build.onLoad({ filter: /(?:mcd-companion-picker|mcd-companion-tool|scientific-spectra-dock-content|scientific-spectra-panel|scientific-spectra-tool|scene-spectra)\.tsx?$/ }, ({ path }) => {
    const code = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })?.code;
    if (!code) throw new Error(`No compiled source: ${path}`);
    return { contents: code, loader: path.endsWith(".tsx") ? "tsx" : "ts" };
  });
} });
