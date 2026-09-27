// scripts/native-workspace-xyzrender.mjs
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

// apps/desktop/src/lib/xyzrender-orientation.ts
function validatedAngles(angles) {
  if (!Array.isArray(angles) || angles.length !== 3 || angles.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 360))
    throw new Error("Orientation requires three angles between −360° and 360°");
  return angles;
}
function rotateVector(position, angles) {
  let [x, y, z] = position;
  for (let axis = 0;axis < 3; axis++) {
    const angle = angles[axis] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 0)
      [y, z] = [y * c - z * s, y * s + z * c];
    if (axis === 1)
      [x, z] = [x * c + z * s, -x * s + z * c];
    if (axis === 2)
      [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}
function rotateXyzrenderReference(text, value) {
  const angles = validatedAngles(value);
  const lines = text.trim().split(/\r?\n/);
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count < 1 || count > 1e5 || lines.length < count + 2)
    throw new Error("Invalid orientation reference");
  const atoms = lines.slice(2, count + 2).map((line) => {
    const [symbol, ...values] = line.trim().split(/\s+/);
    return { symbol, p: values.slice(0, 3).map(Number) };
  });
  if (atoms.some((a) => a.p.length !== 3 || a.p.some((n) => !Number.isFinite(n))))
    throw new Error("Invalid reference coordinates");
  const center = [0, 1, 2].map((i) => atoms.reduce((sum, atom) => sum + atom.p[i], 0) / count);
  for (const atom of atoms) {
    atom.p = rotateVector(atom.p.map((n, i) => n - center[i]), angles).map((n, i) => n + center[i]);
  }
  return `${count}
Burette orientation
${atoms.map((a) => `${a.symbol} ${a.p.map((n) => n.toFixed(9)).join(" ")}`).join(`
`)}
`;
}

// apps/desktop/vite/browser-dev/xyzrender-animation-options.ts
function xyzrenderAnimationArguments(value, output) {
  if (!value || typeof value !== "object")
    throw new Error("Missing animation options");
  const input = value;
  const mode = String(input.mode || "rotation");
  const axis = String(input.axis || "y");
  if (!["rotation", "bounce", "trajectory", "vibration", "assembly"].includes(mode))
    throw new Error("Unknown animation mode");
  if (!/^-?(?:x|y|z|xy|xz|yz|yx|zx|zy|\d{3})$/.test(axis))
    throw new Error("Invalid rotation axis");
  const bounded = (name, fallback, min, max) => {
    const n = input[name] === undefined ? fallback : Number(input[name]);
    if (!Number.isFinite(n) || n < min || n > max)
      throw new Error(`Invalid animation ${name}: expected ${min}–${max}`);
    return n;
  };
  const size = bounded("size", 480, 128, 1024);
  const frames = bounded("frames", 120, 2, 240);
  const fps = bounded("fps", 10, 1, 30);
  if (![size, frames, fps].every(Number.isInteger))
    throw new Error("Size, frames and fps must be integers");
  if (size * size * frames > 1e8)
    throw new Error("Use fewer frames or a smaller image");
  const args = ["-S", String(size), "--gif-fps", String(fps), "--rot-frames", String(frames), "-go", output];
  const rotationArgs = axis.startsWith("-") ? [`--gif-rot=${axis}`] : ["--gif-rot", axis];
  if (mode === "rotation")
    args.push(...rotationArgs);
  if (mode === "bounce")
    args.push("--gif-bounce", `${bounded("amplitude", 45, 1, 180)},${axis}`);
  if (mode === "trajectory") {
    args.push("--gif-trj");
    if (input.rebuildBonds === true)
      args.push("--trj-bonds");
  }
  if (mode === "vibration")
    args.push("--gif-ts", "--vib-frames", String(frames));
  if ((mode === "vibration" || mode === "trajectory") && input.rotate === true)
    args.push(...rotationArgs);
  if (mode === "assembly") {
    args.push("--gif-diffuse", "--diffuse-frames", String(frames), "--diffuse-noise", String(bounded("noise", 0.3, 0, 5)));
    const bonds = String(input.bonds || "fade");
    if (!["fade", "show", "hide"].includes(bonds))
      throw new Error("Invalid assembly bonds");
    args.push("--diffuse-bonds", bonds);
    if (input.forward === true)
      args.push("--diffuse-forward");
    if (input.rotate === true)
      args.push(...rotationArgs, "--diffuse-rot", String(bounded("amplitude", 180, 1, 360)));
    if (input.anchor) {
      if (typeof input.anchor !== "string" || input.anchor.length > 2000 || !/^[\w,\s-]+$/.test(input.anchor))
        throw new Error("Invalid anchor selection");
      args.push("--anchor", input.anchor);
    }
  }
  return args;
}

// scripts/native-workspace-xyzrender.mjs
var executeFile = promisify(execFile);
var presets = ["default", "flat", "paton", "pmol", "skeletal", "bubble", "tube", "btube", "mtube", "wire", "graph", "vdw"];
var maxBytes = 512 * 1024;
var maxArtifactBytes = 16 * 1024 * 1024;
async function renderNativeWorkspaceXyz(input, { source, execute = executeFile } = {}) {
  if (input.orientation !== undefined)
    rotateXyzrenderReference(`1
validate
H 0 0 0
`, input.orientation);
  if (input.animation)
    xyzrenderAnimationArguments(input.animation, "animation.gif");
  if (input.exportFormat !== undefined && !["svg", "png", "pdf", "tiff"].includes(input.exportFormat))
    throw new Error("Unsupported export format.");
  const controls = input.controls || {};
  if (controls.customConfigPath || controls.extraArguments || input.preset === "custom")
    throw new Error("Native XYZRender supports built-in presets, not custom config paths or extra CLI arguments.");
  const preset = input.preset || "default";
  if (!presets.includes(preset))
    throw new Error("Unknown XYZRender preset.");
  const extension = input.inputExtension || source?.format;
  if (!["xyz", "sdf", "sd", "mol", "smi", "smiles", "pdb", "cif", "mmcif"].includes(extension))
    throw new Error("Unsupported XYZRender input format.");
  let bytes;
  if (input.inputDataBase64) {
    if (input.inputDataBase64.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.inputDataBase64))
      throw new Error("XYZRender input exceeds 512 KiB or is invalid.");
    bytes = Buffer.from(input.inputDataBase64, "base64");
  } else {
    if (!source || (await stat(source.path)).size > maxBytes)
      throw new Error("XYZRender requires an authorized source of at most 512 KiB.");
    bytes = await readFile(source.path);
  }
  if (!bytes.length)
    throw new Error("Empty XYZRender input.");
  if (extension === "xyz" && input.activeModel != null && !input.animation) {
    if (!Number.isSafeInteger(input.activeModel) || input.activeModel < 0)
      throw new Error("Invalid XYZ frame index.");
    const lines = bytes.toString("utf8").replace(/\r\n?/gu, `
`).trimEnd().split(`
`);
    const frames = [];
    for (let i = 0;i < lines.length; ) {
      if (!lines[i].trim()) {
        i++;
        continue;
      }
      const count = Number(lines[i]);
      if (!Number.isSafeInteger(count) || count < 1 || i + count + 2 > lines.length)
        throw new Error("Invalid XYZ trajectory frame.");
      frames.push(lines.slice(i, i + count + 2).join(`
`) + `
`);
      i += count + 2;
    }
    if (!frames[input.activeModel])
      throw new Error("XYZ trajectory frame is out of range.");
    bytes = Buffer.from(frames[input.activeModel]);
  }
  const candidates = [join(homedir(), ".local/bin/xyzrender"), "/opt/homebrew/bin/xyzrender", "/usr/local/bin/xyzrender", ...String(process.env.PATH || "").split(delimiter).filter(Boolean).map((path) => join(path, "xyzrender"))];
  let executable;
  for (const path of candidates)
    if (await access(path).then(() => true, () => false)) {
      executable = path;
      break;
    }
  if (!executable)
    throw new Error("External xyzrender executable was not found on this host.");
  const directory = await mkdtemp(join(tmpdir(), "burette-native-xyzrender-"));
  const startedAt = Date.now();
  try {
    const inputPath = join(directory, `input.${extension}`);
    const outputPath = join(directory, "render.svg");
    await writeFile(inputPath, bytes);
    const args = [inputPath, "-o", outputPath, "--config", preset];
    const numbers = { canvasSize: "-S", atomScale: "-a", bondWidth: "-b", atomStrokeWidth: "-s", fogStrength: "-F", vdwOpacity: "--vdw-opacity", vdwScale: "--vdw-scale", hullOpacity: "--hull-opacity", poreOpacity: "--pore-opacity", cellWidth: "--cell-width", fieldIso: "--iso", fieldOpacity: "--opacity" };
    for (const [key, flag] of Object.entries(numbers))
      if (controls[key] != null) {
        const value = Number(controls[key]);
        if (!Number.isFinite(value) || value < 0 || value > (key === "canvasSize" ? 2048 : 100))
          throw new Error(`Invalid XYZRender ${key}.`);
        args.push(flag, String(value));
      }
    for (const [key, yes, no] of [["transparentBackground", "--transparent"], ["gradients", "--grad", "--no-grad"], ["fog", "--fog", "--no-fog"], ["hideBonds", "--no-bonds"], ["showCell", "--cell", "--no-cell"], ["showGhosts", "--ghosts", "--no-ghosts"], ["showAxes", "--axes", "--no-axes"]]) {
      if (controls[key] === true)
        args.push(yes);
      else if (controls[key] === false && no)
        args.push(no);
    }
    const selector = (value) => {
      if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u.test(value) || value.length > 512)
        throw new Error("Invalid atom selector.");
      return value;
    };
    if (controls.showVdw && preset !== "vdw") {
      args.push("--vdw");
      if (controls.vdwAtoms)
        args.push(selector(controls.vdwAtoms));
    }
    const hull = controls.hullAtoms ? selector(controls.hullAtoms) : ["benzene-ring", "anthracene-rings", "auto-rings"].includes(controls.hullMode) ? "rings" : ["faces", "mof5-faces", "faces-pore"].includes(controls.hullMode) ? "faces" : null;
    if (hull)
      args.push("--hull", hull);
    if (["pore", "mof5-pore", "faces-pore"].includes(controls.hullMode))
      args.push("--pore");
    if (controls.displayHydrogens === "all")
      args.push("--hy");
    if (controls.displayHydrogens === "none")
      args.push("--no-hy");
    if (["aromatic", "kekule"].includes(controls.bondNotation))
      args.push("--bo", ...controls.bondNotation === "kekule" ? ["-k"] : []);
    if (controls.molColor) {
      if (!/^(#[0-9a-f]{3,8}|[a-z]+)$/iu.test(controls.molColor))
        throw new Error("Invalid molecular color.");
      args.push("--mol-color", controls.molColor);
    }
    if (controls.supercell) {
      if (!Array.isArray(controls.supercell) || controls.supercell.length !== 3 || controls.supercell.some((n) => !Number.isInteger(n) || n < 1 || n > 4))
        throw new Error("Native XYZRender supercell is limited to 4 per axis.");
      args.push("--supercell", ...controls.supercell.map(String));
    }
    if (controls.fieldMode && controls.fieldMode !== "auto")
      throw new Error("Volumetric-field rendering is not supported in the native workspace.");
    if (controls.regions?.length > 16)
      throw new Error("Too many XYZRender regions.");
    for (const region of controls.regions || []) {
      if (!presets.includes(region.preset))
        throw new Error("Unknown region preset.");
      args.push("--region", selector(region.atoms), region.preset);
    }
    let refPath;
    let orientationRef = input.orientationRef;
    let baseOrientationRef = orientationRef;
    if (input.orientationRef) {
      if (typeof input.orientationRef !== "string" || Buffer.byteLength(input.orientationRef) > 65536)
        throw new Error("Orientation reference exceeds 64 KiB.");
      refPath = join(directory, "orientation.xyz");
      await writeFile(refPath, input.orientationRef);
    }
    const executionOptions = {
      timeout: 25000,
      maxBuffer: 65536,
      env: { ...process.env, PYTHON_CPU_COUNT: "2", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" }
    };
    if (input.orientation !== undefined) {
      refPath ||= join(directory, "orientation.xyz");
      if (!baseOrientationRef) {
        await execute(executable, [...args, "--ref", refPath], executionOptions);
        if ((await stat(refPath)).size > 65536)
          throw new Error("Orientation reference exceeds 64 KiB.");
        baseOrientationRef = await readFile(refPath, "utf8");
      }
      orientationRef = rotateXyzrenderReference(baseOrientationRef, input.orientation);
      await writeFile(refPath, orientationRef);
    }
    const animationPath = join(directory, "animation.gif");
    const animationArgs = input.animation ? xyzrenderAnimationArguments(input.animation, animationPath) : [];
    const run = (ref) => execute(executable, [...args, ...ref ? ["--ref", ref] : [], ...animationArgs], { ...executionOptions, timeout: input.animation ? 45000 : executionOptions.timeout });
    let result;
    try {
      result = await run(refPath);
    } catch (error) {
      if (error.killed && error.signal === "SIGTERM")
        throw new Error("XYZRender exceeded its time limit. Try fewer animation frames or a smaller image.");
      if (!refPath || !`${error.stderr}${error.stdout}${error.message}`.includes("--ref is not supported for periodic structures"))
        throw error;
      throw new Error("XYZRender orientation references are not supported for periodic structures. Reset the orientation reference before rendering or exporting.");
    }
    if ((await stat(outputPath)).size > maxBytes)
      throw new Error("XYZRender SVG exceeds the native 512 KiB limit.");
    const svg = await readFile(outputPath, "utf8");
    if (!svg.includes("<svg"))
      throw new Error("XYZRender produced no SVG.");
    const boundedArtifact = async (path) => {
      if ((await stat(path)).size > maxArtifactBytes)
        throw new Error("XYZRender artifact exceeds 16 MiB. Reduce its size or frame count.");
      return (await readFile(path)).toString("base64");
    };
    const gifBase64 = input.animation ? await boundedArtifact(animationPath) : undefined;
    let artifactBase64;
    if (input.exportFormat === "svg")
      artifactBase64 = Buffer.from(svg).toString("base64");
    else if (input.exportFormat) {
      const exportPath = join(directory, `figure.${input.exportFormat}`);
      const exportArgs = [...args];
      exportArgs[exportArgs.indexOf("-o") + 1] = exportPath;
      await execute(executable, [...exportArgs, ...refPath ? ["--ref", refPath] : []], executionOptions);
      artifactBase64 = await boundedArtifact(exportPath);
    }
    return {
      svg,
      orientationRef,
      baseOrientationRef,
      gifBase64,
      artifactBase64,
      exportFormat: input.exportFormat,
      preset,
      configArgument: preset,
      elapsedMs: Date.now() - startedAt,
      log: `${result.stdout || ""}${result.stderr || ""}`.slice(0, 4096),
      activeModel: input.activeModel,
      xyzrenderControls: controls
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export {
  renderNativeWorkspaceXyz
};
