import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
plugin({ name: "geometry-binding-react-compiler", setup(build) {
  build.onLoad({ filter: /hooks\/use-geometry-binding\.ts$/u }, ({ path }) => {
    const compiled = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    if (!compiled?.code?.includes("react/compiler-runtime")) throw new Error("The Geometry binding hook was not compiled.");
    return { contents: compiled.code, loader: "ts" };
  });
} });
