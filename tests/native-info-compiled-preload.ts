import "./scientific-import-compiled-preload";
import "./fixtures/cjson-compute-compiler";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
plugin({ name: "native-info-owner-compiler", setup(build) {
 build.onLoad({ filter: /use-native-scene-composition\.ts$/u }, ({ path }) => {
  const result = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
   parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
  if (!result?.code) throw new Error("Native Info compiler returned no source");
  console.log(JSON.stringify({ file: path.split("/").pop(), cacheEmitted: result.code.includes("react/compiler-runtime") }));
  return { contents: result.code, loader: "tsx" };
 });
} });
