import "./structure-edit-compiled-preload";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "properties-production-compiler-proof", setup(build) {
  build.onLoad({ filter: /components\/workbench\/properties-(?:dialog|entrypoint)\.tsx$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "tsx",
  }));
} });
