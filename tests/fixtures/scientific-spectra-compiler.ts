import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "spectrum-react-compiler", setup(build) {
  build.onLoad({ filter: /(?:scientific-spectra-(panel|dock-content)\.tsx|scene-spectra\.ts)$/ }, ({ path }) => {
    let successes = 0;
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [["babel-plugin-react-compiler", { logger: { logEvent(_file: string, event: { kind: string }) { if (event.kind === "CompileSuccess") successes++; } } }]] });
    console.log(JSON.stringify({ file: path.split("/").pop(), compiledComponents: successes }));
    return { contents: result!.code!, loader: "tsx" };
  });
} });
