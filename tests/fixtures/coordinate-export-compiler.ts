import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";

// Run the actual actions through the app's normal compiler pass; report bailouts
// separately rather than claiming every function in a module emitted a cache.
plugin({ name: "coordinate-export-compiler", setup(build) {
  build.onLoad({ filter: /apps\/desktop\/src\/components\/(?:geometry-panel|workbench\/(?:zmatrix-panel|geometry-fields))\.tsx$/u }, ({ path }) => {
    let compiledFunctions = 0;
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {
        logger: { logEvent(_file: string, event: { kind: string }) { if (event.kind === "CompileSuccess") compiledFunctions++; } },
      }]] });
    if (!result?.code) throw new Error("Coordinate action compilation returned no module.");
    const cacheEmitted = result.code.includes("react/compiler-runtime");
    if (!path.endsWith("/zmatrix-panel.tsx") && (!cacheEmitted || !compiledFunctions)) throw new Error("Geometry consumer compilation did not emit its cache.");
    console.log(JSON.stringify({ file: path.split("/").pop(), cacheEmitted, compiledFunctions }));
    return { contents: result.code, loader: "tsx" };
  });
} });
