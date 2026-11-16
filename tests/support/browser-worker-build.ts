import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);

/** Bundles a module worker for the browser like Vite does, including `?url` asset imports as file URLs. */
export async function buildBrowserWorker(entry: URL) {
  const built = await Bun.build({ entrypoints: [entry.pathname], target: "browser", format: "esm", plugins: [{ name: "asset-url", setup(build) {
    build.onResolve({ filter: /\?url$/u }, args => ({ path: require.resolve(args.path.slice(0, -4)), namespace: "asset-url" }));
    build.onLoad({ filter: /.*/u, namespace: "asset-url" }, args => ({ contents: `export default ${JSON.stringify(pathToFileURL(args.path).href)};`, loader: "js" }));
  } }] });
  if (!built.success) throw new AggregateError(built.logs, `${entry.pathname} build failed`);
  return built;
}
