import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "cjson-owning-scene-react-compiler", setup(build) {
  build.onLoad({ filter: /(?:scene-compute-menu\.tsx|page-kinds\/file\.tsx|use-app-file-open\.ts)$/u }, ({ path }) => {
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    if (!result?.code) throw new Error(`Compiler returned no source: ${path}`);
    console.log(JSON.stringify({ file: path.split("/").pop(), cacheEmitted: result.code.includes("react/compiler-runtime") }));
    return { contents: result.code, loader: "tsx" };
  });
} });
