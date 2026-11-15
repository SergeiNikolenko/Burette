import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "structure-edit-production-compiler-proof", setup(build) {
  build.onLoad({ filter: /(?:components\/dock-panel\.tsx|components\/workbench\/structure-edit-panel\.tsx|components\/workbench\/structure-edit\/[^/]+\.tsx|(?:components|lib)\/workbench\/use-graph-draft\.ts)$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!,
    loader: path.endsWith(".tsx") ? "tsx" : "ts",
  }));
} });
