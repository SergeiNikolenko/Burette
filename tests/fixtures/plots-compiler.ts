import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "retained-plots-react-compiler", setup(build) {
  build.onLoad({ filter: /(?:plots-panel\.tsx|plots-dock-content\.tsx|plots-tool\.ts|retained-trajectory-source\.ts|scene-compute-menu\.tsx|dock-panel\.tsx|page-kinds\/file\.tsx|command-palette\/index\.tsx)$/u }, ({ path }) => {
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    if (!result?.code) throw new Error(`Compiler returned no source: ${path}`);
    console.log(JSON.stringify({ file: path.split("/").pop(), cacheEmitted: result.code.includes("react/compiler-runtime") }));
    return { contents: result.code, loader: "tsx" };
  });
} });
