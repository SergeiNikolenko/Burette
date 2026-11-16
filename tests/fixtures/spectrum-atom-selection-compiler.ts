import "./scientific-spectra-compiler";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
plugin({ name: "spectrum-selection-compiler", setup(build) {
  build.onLoad({ filter: /use-spectrum-atom-selection\.ts$/u }, ({ path }) => {
    let compiled = false;
    const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] },
      plugins: [["babel-plugin-react-compiler", { logger: { logEvent(_file: string, event: { kind: string }) { if (event.kind === "CompileSuccess") compiled = true; } } }]] });
    console.log(JSON.stringify({ file: path.split("/").pop(), compiled }));
    return { contents: result!.code!, loader: "ts" };
  });
} });
