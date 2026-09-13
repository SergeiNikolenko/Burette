import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { extractKetcherSchemaCatalog } from "./ketcher-schema-catalog";
import { schemaIdentity } from "../src/lib/ketcher-precompiled-validation";

const virtualId = "virtual:burette-ketcher-validation";

export function generateKetcherValidators(source: string, core: string, ketcherPath: string) {
  const require = createRequire(realpathSync(ketcherPath));
  const Ajv = require("ajv");
  const standalone = require("ajv/dist/standalone");
  const { _ } = require("ajv/dist/compile/codegen");
  const { forms, optionsSettings } = extractKetcherSchemaCatalog(source, core, require);
  const imports = new Map<string, string>();
  const entries = [...forms.map((entry) => ({ ...entry, settings: false })),
    { name: "savedOptions", schema: optionsSettings, formats: [], settings: true }];
  const registry = entries.map(({ schema, formats, settings }) => {
    const prepared = require("lodash").cloneDeep(schema);
    const ajv = new Ajv(settings
      ? { allErrors: true, keywords: [{ keyword: "enumNames", schemaType: "array" }], code: { source: true } }
      : { allErrors: true, verbose: true, strictSchema: false, code: { source: true, formats: _`formats` } });
    for (const name of formats) {
      ajv.addFormat(name, () => true);
      const property = prepared.properties[name];
      for (const key of ["pattern", "maxLength", "enum", "enumNames"]) delete property[key];
      property.format = name;
    }
    let code = standalone(ajv, ajv.compile(prepared));
    code = code.replace(/require\("([^"]+)"\)/g, (_match: string, specifier: string) => {
      const path = require.resolve(specifier);
      if (!imports.has(path)) imports.set(path, `runtime${imports.size}`);
      return imports.get(path)!;
    });
    const identity = `${settings ? "settings:" : "form:"}${schemaIdentity(prepared)}`;
    return `[${JSON.stringify(identity)}, (formats) => { const module = { exports: {} }; ${code}; return module.exports; }]`;
  });
  const runtime = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/ketcher-precompiled-validation.ts");
  return `${[...imports].map(([path, name]) => `import * as ${name} from ${JSON.stringify(path)};`).join("\n")}
import { schemaIdentity, bindSchemaErrors } from ${JSON.stringify(runtime)};
const factories = new Map([${registry.join(",\n")}]);
export function compileKetcherSchema(schema, formats = {}, settings = false) {
  const factory = factories.get((settings ? 'settings:' : 'form:') + schemaIdentity(schema));
  if (!factory) throw new Error('Unsupported Ketcher validation schema; rebuild the hosted widget');
  return bindSchemaErrors(factory(formats), schema);
}`;
}

export function ketcherCspValidationPlugin(enabled: boolean): Plugin {
  let generated: string | undefined;
  return {
    name: "burette-ketcher-csp-validation",
    enforce: "pre",
    resolveId(id) { return enabled && id === virtualId ? `\0${virtualId}` : null; },
    load(id) { return id === `\0${virtualId}` ? generated : null; },
    transform(source, id) {
      if (!enabled || !/\/ketcher-react\/dist\/index\.js$/.test(id.replace(/\\/g, "/"))) return null;
      const require = createRequire(realpathSync(id));
      const corePath = resolve(dirname(require.resolve("ketcher-core")), "index.modern.js");
      generated = generateKetcherValidators(source, readFileSync(corePath, "utf8"), id);
      function replaceOne(pattern: RegExp, replacement: string) {
        const matches = source.match(pattern);
        if (matches?.length !== 1) throw new Error(`Ketcher validation boundary changed: ${pattern}`);
        source = source.replace(pattern, replacement);
      }
      replaceOne(/import Ajv from 'ajv';/g, `import { compileKetcherSchema } from '${virtualId}';`);
      replaceOne(/  var ajv = new Ajv\(\{\s*allErrors: true,\s*keywords: \[\{\s*keyword: 'enumNames',\s*schemaType: 'array'\s*\}\]\s*\}\);\s*var validate = ajv.compile\(optionsSchema\);/g,
        "  var validate = compileKetcherSchema(optionsSchema, {}, true);");
      replaceOne(/  var ajv = new Ajv\(\{\s*allErrors: true,\s*verbose: true,\s*strictSchema: false\s*\}\);/g, "");
      replaceOne(/      ajv.addFormat\(formatName, formatValidator\);/g, "");
      replaceOne(/  var validate = ajv.compile\(schemaCopy\);/g,
        "  var validate = compileKetcherSchema(schemaCopy, customValid || {});");
      if (/\b(?:new Ajv|ajv\.compile)\b/.test(source)) throw new Error("Unconverted Ketcher runtime compiler");
      return { code: source, map: null };
    },
  };
}
