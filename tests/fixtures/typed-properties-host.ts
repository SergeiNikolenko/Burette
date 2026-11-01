import { expect } from "bun:test";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// Exact small fixtures and independent numeric values frozen before implementation
// in typed-properties-independent/oracle-before-source (numeric-oracle SHA 24a51c12...).
export const propertyCases = [{"name":"ethanol-implicit","source":"ethanol\n  Burette           3D\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    3.3961    1.6255    1.9216 C   0  0  0  0  0  0  0  0  0  0  0  0\n    2.4505    0.5871    1.3772 C   0  0  0  0  0  0  0  0  0  0  0  0\n    2.6687    0.4272   -0.0178 O   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0  0  0  0\n  2  3  1  0  0  0  0\nM  END\n> <ID>\nEtOH-1\n\n$$$$\n","elements":["C","C","O"],"properties":{"formula":"C2H6O","atomCount":3,"bondCount":2,"charge":0,"molecularWeight":46.069,"exactMass":46.041864812}},{"name":"ethanol-explicit","source":"SO#1\nOCL MolfileCreator  3D\n\n  0  0  0  0  0  0              0 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 9 8 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 C -0.3172157403 2.7958200888 -1.7134732467 0\nM  V30 2 C 0.6012073569 2.2235708932 -2.7623886222 0\nM  V30 3 O 0.1083984841 2.54785071 -4.0497207767 0\nM  V30 4 H 0.0180242935 2.5694491512 -0.8210647761 0\nM  V30 5 H -0.3562656551 3.7706521058 -1.8068424089 0\nM  V30 6 H -1.2165438257 2.421909659 -1.8233495658 0\nM  V30 7 H 1.5089292238 2.6008443981 -2.639996282 0\nM  V30 8 H 0.6440650621 1.2394546754 -2.6591378607 0\nM  V30 9 H 0.6494233707 2.3139149593 -4.6461618824 0\nM  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 1 1 1 2\nM  V30 2 1 2 3\nM  V30 3 1 1 4\nM  V30 4 1 1 5\nM  V30 5 1 1 6\nM  V30 6 1 2 7\nM  V30 7 1 2 8\nM  V30 8 1 3 9\nM  V30 END BOND\nM  V30 END CTAB\nM  END\n> <FOREIGN_NOTE>\nunchanged scientific source\n\n> <BURETTE_METADATA_V1>\n{\"version\":1,\"atoms\":[{\"id\":\"00000000-0000-4000-8000-000000000001\",\"atomName\":\"C1\"},{\"id\":\"00000000-0000-4000-8000-000000000002\",\"atomName\":\"C2\"},{\"id\":\"00000000-0000-4000-8000-000000000003\",\"atomName\":\"O3\"},{\"id\":\"00000000-0000-4000-8000-000000000004\",\"atomName\":\"H4\"},{\"id\":\"00000000-0000-4000-8000-000000000005\",\"atomName\":\"H5\"},{\"id\":\"00000000-0000-4000-8000-000000000006\",\"atomName\":\"H6\"},{\"id\":\"00000000-0000-4000-8000-000000000007\",\"atomName\":\"H7\"},{\"id\":\"00000000-0000-4000-8000-000000000008\",\"atomName\":\"H8\"},{\"id\":\"00000000-0000-4000-8000-000000000009\",\"atomName\":\"H9\"}],\"conformer\":{\"id\":\"00000000-0000-4000-8000-000000001000\",\"label\":\"Independent reference\"}}\n\n$$$$\n","elements":["C","C","O","H","H","H","H","H","H"],"properties":{"formula":"C2H6O","atomCount":9,"bondCount":8,"charge":0,"molecularWeight":46.06900000000002,"exactMass":46.041864812},"charges":[-0.04183848615477238,0.040220581749086416,-0.3966637147812598,0.02537329159235665,0.02537329159235665,0.02537329159235665,0.056069718921006324,0.056069718921006324,0.21002230656786322]},{"name":"ethanol-reordered","source":"\n     RDKit          3D\n\n  0  0  0  0  0  0  0  0  0  0999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 9 8 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 H 0.649423 2.313915 -4.646162 0\nM  V30 2 O 0.108398 2.547851 -4.049721 0\nM  V30 3 H 1.508929 2.600844 -2.639996 0\nM  V30 4 C -0.317216 2.795820 -1.713473 0\nM  V30 5 H 0.644065 1.239455 -2.659138 0\nM  V30 6 C 0.601207 2.223571 -2.762389 0\nM  V30 7 H -1.216544 2.421910 -1.823350 0\nM  V30 8 H 0.018024 2.569449 -0.821065 0\nM  V30 9 H -0.356266 3.770652 -1.806842 0\nM  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 1 1 4 6\nM  V30 2 1 6 2\nM  V30 3 1 4 8\nM  V30 4 1 4 9\nM  V30 5 1 4 7\nM  V30 6 1 6 3\nM  V30 7 1 6 5\nM  V30 8 1 2 1\nM  V30 END BOND\nM  V30 END CTAB\nM  END\n> <FOREIGN_NOTE>\nunchanged scientific source\n\n> <BURETTE_METADATA_V1>\n{\"version\":1,\"atoms\":[{\"id\":\"00000000-0000-4000-8000-000000000009\",\"atomName\":\"H9\"},{\"id\":\"00000000-0000-4000-8000-000000000003\",\"atomName\":\"O3\"},{\"id\":\"00000000-0000-4000-8000-000000000007\",\"atomName\":\"H7\"},{\"id\":\"00000000-0000-4000-8000-000000000001\",\"atomName\":\"C1\"},{\"id\":\"00000000-0000-4000-8000-000000000008\",\"atomName\":\"H8\"},{\"id\":\"00000000-0000-4000-8000-000000000002\",\"atomName\":\"C2\"},{\"id\":\"00000000-0000-4000-8000-000000000006\",\"atomName\":\"H6\"},{\"id\":\"00000000-0000-4000-8000-000000000004\",\"atomName\":\"H4\"},{\"id\":\"00000000-0000-4000-8000-000000000005\",\"atomName\":\"H5\"}],\"conformer\":{\"id\":\"00000000-0000-4000-8000-000000001000\",\"label\":\"Independent reference\"}}\n\n$$$$\n","elements":["H","O","H","C","H","C","H","H","H"],"properties":{"formula":"C2H6O","atomCount":9,"bondCount":8,"charge":0,"molecularWeight":46.06900000000001,"exactMass":46.041864812},"charges":[0.21002230656786322,-0.3966637147812598,0.056069718921006324,-0.04183848615477238,0.056069718921006324,0.040220581749086416,0.02537329159235665,0.02537329159235665,0.02537329159235665]},{"name":"water-explicit","source":"SO#1\nOCL MolfileCreator  3D\n\n  0  0  0  0  0  0              0 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 3 2 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 O 1.2605630083 1.3614880309 -0.8288511967 0\nM  V30 2 H 1.9622975228 1.7551607657 -1.1168293758 0\nM  V30 3 H 0.5769532641 1.6621522817 -1.2443264768 0\nM  V30 END ATOM\nM  V30 BEGIN BOND\nM  V30 1 1 1 2\nM  V30 2 1 1 3\nM  V30 END BOND\nM  V30 END CTAB\nM  END\n> <FOREIGN_NOTE>\nunchanged scientific source\n\n> <BURETTE_METADATA_V1>\n{\"version\":1,\"atoms\":[{\"id\":\"00000000-0000-4000-8000-000000000001\",\"atomName\":\"O1\"},{\"id\":\"00000000-0000-4000-8000-000000000002\",\"atomName\":\"H2\"},{\"id\":\"00000000-0000-4000-8000-000000000003\",\"atomName\":\"H3\"}],\"conformer\":{\"id\":\"00000000-0000-4000-8000-000000001000\",\"label\":\"Independent reference\"}}\n\n$$$$\n","elements":["O","H","H"],"properties":{"formula":"H2O","atomCount":3,"bondCount":2,"charge":0,"molecularWeight":18.015,"exactMass":18.010564684},"charges":[-0.41150952193742263,0.20575476096871131,0.20575476096871131]}] as const;

export async function builtPropertiesWorkers(root: string, repo: string) {
  const NativeWorker = Worker, descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
  const directory = join(root, "built/apps/desktop/src/lib/molecular-workbench"); await mkdir(directory, { recursive: true });
  const outputs = new Map<string, URL>(), receipts: Record<string, unknown>[] = [];
  for (const name of ["compute-worker"]) {
    const built = await Bun.build({ entrypoints: [join(repo, `apps/desktop/src/lib/molecular-workbench/${name}.ts`)], target: "browser", format: "esm", plugins: [{ name: "vite-wasm-url", setup(build) {
      build.onResolve({ filter: /\.wasm\?url$/u }, async args => ({ path: await Bun.resolve(args.path.slice(0, -4), args.resolveDir), namespace: "wasm-url" }));
      build.onLoad({ filter: /.*/, namespace: "wasm-url" }, async args => { const bytes = await readFile(args.path), url = pathToFileURL(args.path).href; receipts.push({ namespace: "wasm-url", url, sha256: createHash("sha256").update(bytes).digest("hex") }); return { contents: `export default ${JSON.stringify(url)}`, loader: "js" }; });
    } }] });
    expect(built.success).toBe(true); expect(built.outputs).toHaveLength(1);
    const path = join(directory, `${name}.mjs`); await Bun.write(path, built.outputs[0]); outputs.set(`${name}.ts`, pathToFileURL(path)); receipts.push({ worker: name, target: "browser", sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  const assets = join(root, "built/PreviewExtension/Web/rdkit-conformer"); await mkdir(assets, { recursive: true });
  await cp(join(repo, "PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm"), join(assets, "Burette_rdkit_conformer.wasm"));
  receipts.push({ wasm: "RDKitConformer", sha256: createHash("sha256").update(await readFile(join(assets, "Burette_rdkit_conformer.wasm"))).digest("hex") });
  console.log(JSON.stringify({ fixture: "properties-browser-workers", receipts }));
  const pending: (() => void)[] = []; let held = "";
  const records: { name: string; action: string; terminated: boolean }[] = [];
  class BrowserWorker extends NativeWorker {
    constructor(url: ConstructorParameters<typeof NativeWorker>[0], options?: ConstructorParameters<typeof NativeWorker>[1]) {
      const name = String(url).split("/").at(-1)!, output = outputs.get(name); super(output ?? url, options);
      const entry = { name, action: "", terminated: false }; if (output) records.push(entry);
      return new Proxy(this, {
        set(target, key, value) { if (key === "onmessage" && typeof value === "function") { target.onmessage = event => { const deliver = () => value.call(target, event); if (held && entry.action === held) pending.push(deliver); else deliver(); }; return true; } return Reflect.set(target, key, value); },
        get(target, key) {
          if (key === "postMessage") return (message: { action?: string }, options?: StructuredSerializeOptions) => { entry.action = message.action ?? ""; return Reflect.get(target, key).call(target, message, options); };
          if (key === "terminate") return () => { entry.terminated = true; return target.terminate(); };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
  }
  Object.defineProperty(globalThis, "Worker", { ...descriptor, value: BrowserWorker });
  return { records, pending, hold(action: string) { held = action; }, release() { held = ""; for (const deliver of pending.splice(0)) deliver(); }, restore() { Object.defineProperty(globalThis, "Worker", descriptor); } };
}

// Same stdio JSON-RPC transport as the existing bundled MCP test, with a deadline
// long enough for control_viewer's actual 10s CLI wait. No CLI or schema mocks.
export async function mcpPropertiesClient(repo: string) {
  const child = spawn(Bun.which("node")!, [join(repo, "plugins/burette-agent/mcp/lib/server-bundle.mjs"), "--stdio"], { cwd: join(repo, "plugins/burette-agent"), stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", errors = "", next = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const stop = (error: Error) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.stderr.on("data", data => { errors = (errors + data).slice(-65536); });
  child.stdout.on("data", data => { buffer += data; if (buffer.length > 1024 * 1024) { stop(new Error("MCP output exceeds fixture bound")); child.kill(); return; } let at: number; while ((at = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (!line.trim()) continue; const message = JSON.parse(line), item = pending.get(message.id); if (item) { clearTimeout(item.timer); pending.delete(message.id); if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result); } } });
  child.on("error", stop); child.on("exit", code => stop(new Error(`MCP exited ${code}: ${errors}`)));
  const request = (method: string, params: unknown) => new Promise<any>((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${errors}`)); }, 15000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "properties-live-host", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  return { control: (sessionDir: string, action: Record<string, unknown>) => request("tools/call", { name: "burette.control_viewer", arguments: { sessionDir, action: { type: "workbench", ...action }, waitMs: 10000 } }), close() { child.kill("SIGTERM"); stop(new Error("MCP fixture closed")); } };
}
