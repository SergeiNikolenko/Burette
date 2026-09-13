import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { extractKetcherSchemaCatalog } from "../apps/desktop/vite/ketcher-schema-catalog.ts";
import { generateKetcherValidators, ketcherCspValidationPlugin } from "../apps/desktop/vite/ketcher-csp-validation.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
// Optional for running this focused test against an existing dependency install.
const dependencyRoot = process.env.BURETTE_TEST_DEPENDENCY_ROOT || root;
const entry = realpathSync(resolve(dependencyRoot, "apps/desktop/node_modules/ketcher-react/dist/index.js"));
const requireKetcher = createRequire(entry);
const source = readFileSync(entry, "utf8");
const core = readFileSync(resolve(dirname(requireKetcher.resolve("ketcher-core")), "index.modern.js"), "utf8");
const Ajv = requireKetcher("ajv");
const { cloneDeep } = requireKetcher("lodash");
const catalog = extractKetcherSchemaCatalog(source, core, requireKetcher);
assert.equal(catalog.forms.length, 22);

const generated = generateKetcherValidators(source, core, entry);
const helperPath = resolve(root, "apps/desktop/src/lib/ketcher-precompiled-validation.ts");
const imports = [...generated.matchAll(/^import .+ from ("[^"]+");/gm)].map((match) => JSON.parse(match[1]));
assert.ok(imports.includes(helperPath));
const staticImports = new Map(imports.filter((path) => path !== helperPath).map((path) => {
  assert.match(path.replaceAll("\\", "/"), /\/ajv\/dist\/runtime\/[^/]+\.js$/,
    "the browser validator can only import static Ajv runtime helpers, never its compiler");
  return [path, requireKetcher(path)];
}));
const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
assert.throws(() => runInContext("Function('return true')()", context), /Code generation from strings disallowed/);
assert.throws(() => runInContext("eval('true')", context), /Code generation from strings disallowed/);

function executeModule(text, name) {
  const module = { exports: {} };
  context.exports = module.exports;
  context.module = module;
  context.require = (specifier) => {
    assert.ok(staticImports.has(specifier), `unexpected runtime import: ${specifier}`);
    return staticImports.get(specifier);
  };
  const compiled = ts.transpileModule(text, { fileName: name.replace(/\.js$/, ".ts"), compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  runInContext(`(() => { ${compiled}\n })()`, context, { timeout: 1000, filename: name });
  return module.exports;
}
staticImports.set(helperPath, executeModule(readFileSync(helperPath, "utf8"), "validation-runtime.js"));
const { compileKetcherSchema } = executeModule(generated, "precompiled-ketcher.js");

// Exercise the actual browser bundler's CJS interop, not only TS/Bun interop.
const requireProject = createRequire(resolve(dependencyRoot, "package.json"));
const requireVite = createRequire(requireProject.resolve("vite"));
const { rolldown } = await import(requireVite.resolve("rolldown"));
const bundle = await rolldown({
  input: "virtual:ketcher-validator-test", platform: "browser",
  plugins: [{
    name: "ketcher-validator-test-entry",
    resolveId(id) { return id === "virtual:ketcher-validator-test" ? `\0${id}` : null; },
    load(id) { return id === "\0virtual:ketcher-validator-test" ? generated : null; },
  }],
});
let bundledCompile;
try {
  const { output } = await bundle.generate({ format: "iife", name: "KetcherValidation" });
  assert.equal(output.length, 1, "the validator bundle must have no external chunks");
  runInContext(output[0].code, context, { timeout: 1000, filename: "bundled-ketcher-validator.js" });
  bundledCompile = context.KetcherValidation.compileKetcherSchema;
} finally { await bundle.close(); }

// Convert cross-realm containers without discarding function-valued error metadata.
function plain(value) {
  if (Array.isArray(value)) return Array.from(value, plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}

function prepare(schema, formats) {
  const prepared = cloneDeep(schema);
  for (const name of formats) {
    for (const key of ["pattern", "maxLength", "enum", "enumNames"]) delete prepared.properties[name][key];
    prepared.properties[name].format = name;
  }
  return prepared;
}

function representative(schema, name = "") {
  if (schema.enum) return cloneDeep(schema.enum[0]);
  if (schema.type === "object") return Object.fromEntries(Object.entries(schema.properties || {})
    .map(([key, property]) => [key, representative(property, key)]));
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number") return schema.minimum ?? 1;
  if (name === "filename") return "molecule";
  if (name === "isotope" || name === "charge") return "";
  if (name === "subscript") return "n";
  return "x".repeat(Math.max(1, schema.minLength || 0));
}

let comparisons = 0;
const entries = [...catalog.forms.map((form) => ({ ...form, settings: false })),
  { name: "savedOptions", schema: catalog.optionsSettings, formats: [], settings: true }];
for (const entry of entries) {
  const prepared = prepare(entry.schema, entry.formats);
  const cases = [undefined, null, true, 1, "not an object", [], {}, representative(prepared)];
  for (const [name, property] of Object.entries(prepared.properties)) {
    const base = representative(prepared);
    const absent = { ...base };
    delete absent[name];
    cases.push(absent);
    for (const value of [null, {}, [], false, "", "invalid<value>", -1, 0, 1, 1.5, Infinity]) cases.push({ ...base, [name]: value });
    if (property.maxLength !== undefined) cases.push({ ...base, [name]: "x".repeat(property.maxLength + 1) });
    if (property.minimum !== undefined) cases.push({ ...base, [name]: property.minimum - 1 });
    if (property.maximum !== undefined) cases.push({ ...base, [name]: property.maximum + 1 });
    if (property.type === "array") cases.push({ ...base, [name]: ["unexpected", 1, null] });
  }
  for (const result of entry.formats.length ? [true, false] : [true]) {
    const formats = Object.fromEntries(entry.formats.map((name) => [name, () => result]));
    const original = new Ajv(entry.settings
      ? { allErrors: true, keywords: [{ keyword: "enumNames", schemaType: "array" }] }
      : { allErrors: true, verbose: true, strictSchema: false });
    for (const [name, validate] of Object.entries(formats)) original.addFormat(name, validate);
    const expected = original.compile(prepared);
    const actual = compileKetcherSchema(prepared, formats, entry.settings);
    for (const data of cases) {
      const before = cloneDeep(data);
      const expectedValid = expected(data);
      const expectedErrors = expected.errors;
      const actualValid = actual(data);
      assert.equal(actualValid, expectedValid, `${entry.name}: validity parity`);
      assert.deepEqual(plain(actual.errors), plain(expectedErrors), `${entry.name}: complete Ajv error parity`);
      assert.deepEqual(data, before, `${entry.name}: validation must not mutate data`);
      comparisons++;
    }
  }
}

const atom = catalog.forms.find((form) => form.name === "atom");
const preparedAtom = prepare(atom.schema, atom.formats);
let allowed = true;
const acceptingFormats = Object.fromEntries(atom.formats.map((name) => [name, () => allowed]));
const rejectingFormats = Object.fromEntries(atom.formats.map((name) => [name, () => false]));
const first = compileKetcherSchema(preparedAtom, acceptingFormats);
const second = compileKetcherSchema(preparedAtom, rejectingFormats);
const atomData = representative(preparedAtom);
assert.equal(first(atomData), true);
assert.equal(second(atomData), false);
assert.equal(first(atomData), true, "another editor must not replace custom validation closures");
allowed = false;
assert.equal(first(atomData), false, "runtime format closures remain live");
allowed = true;
assert.equal(first(atomData), true);
assert.ok(second.errors.some((error) => error.keyword === "format"), "validator errors are not shared between editors");

const save = catalog.forms.find((form) => form.name === "save:server:molecule");
const validateSave = compileKetcherSchema(save.schema);
const bundledSave = bundledCompile(save.schema);
const originalSave = new Ajv({ allErrors: true, verbose: true, strictSchema: false }).compile(save.schema);
for (const data of [
  { filename: "😀".repeat(128), format: "mol" },
  { filename: "😀".repeat(129), format: "mol" },
  { filename: "molecule", format: "unsupported" },
  { filename: "", format: "mol" },
]) {
  assert.equal(bundledSave(data), originalSave(data), "Rolldown Unicode length/enum validity parity");
  assert.deepEqual(plain(bundledSave.errors), plain(originalSave.errors), "Rolldown full error parity");
}
assert.equal(validateSave({ filename: "", format: "mol" }), false);
const filenameError = validateSave.errors.find((error) => error.instancePath === "/filename");
assert.equal(filenameError.parentSchema.invalidMessage, save.schema.properties.filename.invalidMessage);
assert.equal(filenameError.parentSchema.invalidMessage(filenameError.data), "Filename should contain at least one character");
assert.throws(() => compileKetcherSchema({ type: "object", properties: { unreviewed: { type: "string" } } }), /Unsupported Ketcher validation schema/);
const changed = cloneDeep(preparedAtom);
changed.properties.isotope.maxLength += 1;
assert.throws(() => compileKetcherSchema(changed), /Unsupported Ketcher validation schema/);

const disabled = ketcherCspValidationPlugin(false);
assert.equal(disabled.transform(source, entry), null);
assert.equal(disabled.resolveId("virtual:burette-ketcher-validation"), null);
const enabled = ketcherCspValidationPlugin(true);
assert.equal(enabled.transform(source, "/other/module.js"), null);
const transformed = enabled.transform(source, entry);
assert.ok(transformed);
assert.doesNotMatch(transformed.code, /new Ajv|ajv\.compile/);
assert.ok(enabled.load(enabled.resolveId("virtual:burette-ketcher-validation")));
const originalAst = ts.createSourceFile("ketcher.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
for (const name of ["serializeRewrite", "deserializeRewrite", "getInvalidMessage", "getErrorsObj"]) {
  const fn = originalAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, `expected original ${name}`);
  assert.ok(transformed.code.includes(fn.getText(originalAst)), `${name} must remain untouched`);
}
assert.throws(() => enabled.transform(source.replace("import Ajv from 'ajv';", ""), entry), /validation boundary changed/);
assert.throws(() => extractKetcherSchemaCatalog(source.replace("schema: checkSchema,", "schema: unknownSchema,"), core, requireKetcher), /Missing Ketcher schema dependency/);
console.log(`Ketcher CSP validation passed: ${comparisons} differential cases across 22 forms and saved settings; dynamic code generation blocked`);
