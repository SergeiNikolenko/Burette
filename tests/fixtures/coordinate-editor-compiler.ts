import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";

// The coordinate editor and both panels that host it go through the app's React Compiler pass.
plugin({ name: "coordinate-editor-compiler", setup(build) {
  build.onLoad({ filter: /apps\/desktop\/src\/components\/(?:geometry-panel|workbench\/(?:coordinate-editor|structure-edit-panel|geometry-fields)|workbench\/structure-edit\/[^/]+)\.tsx$/u }, ({ path }) => {
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    if (!result?.code) throw new Error(`React Compiler returned no module for ${path}.`);
    if (path.endsWith("/coordinate-editor.tsx") && !result.code.includes("react/compiler-runtime")) throw new Error("The coordinate editor did not compile.");
    return { contents: result.code, loader: "tsx" };
  });
} });
