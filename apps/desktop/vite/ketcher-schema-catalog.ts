import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

type Schema = Record<string, unknown>;
type ImportResolver = (specifier: string) => unknown;
type SchemaEntry = { name: string; schema: Schema; formats: string[] };

const localRequire = createRequire(import.meta.url);

function parse(source: string) {
  return ts.createSourceFile("ketcher.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

// Evaluate only the dependency closure of selected schemas, never the browser module.
// Input is the pinned, installed package source, not molecular/user-provided data.
function sourceValues(file: ts.SourceFile, resolveImport: ImportResolver) {
  const expressions = new Map<string, string>();
  const imports = new Map<string, () => unknown>();
  const exports = new Map<string, string>();
  const value = (node: ts.Node) => node.getText(file);
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          expressions.set(declaration.name.text, value(declaration.initializer));
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      expressions.set(statement.name.text, value(statement));
    } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) imports.set(clause.name.text, () => {
        const imported = resolveImport(moduleName) as { default?: unknown };
        return imported?.default ?? imported;
      });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) imports.set(binding.name.text, () =>
          (resolveImport(moduleName) as Record<string, unknown>)[binding.propertyName?.text ?? binding.name.text]);
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const item of statement.exportClause.elements) exports.set(item.name.text, item.propertyName?.text ?? item.name.text);
    } else if (ts.isExpressionStatement(statement)) {
      const expression = statement.expression;
      if (ts.isBinaryExpression(expression) && ts.isPropertyAccessExpression(expression.left)
        && expression.left.expression.getText(file) === "exports" && ts.isIdentifier(expression.right)) {
        exports.set(expression.left.name.text, expression.right.text);
      }
      if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) continue;
      const callee = ts.isParenthesizedExpression(expression.expression) ? expression.expression.expression : expression.expression;
      if (!ts.isFunctionExpression(callee) || callee.parameters.length !== 1 || !ts.isIdentifier(callee.parameters[0].name)) continue;
      const enumName = callee.parameters[0].name.text;
      const argument = value(expression.arguments[0]);
      if (argument !== `${enumName} || (${enumName} = {})` && argument !== `exports.${enumName} || (exports.${enumName} = {})`) continue;
      expressions.set(enumName, `(() => { const result = {}; (${value(callee)})(result); return result; })()`);
      if (argument.startsWith("exports.")) exports.set(enumName, enumName);
    }
  }
  const globals: Record<string, unknown> = { require: resolveImport };
  const context = createContext(globals);
  const loaded = new Map<string, unknown>();
  const loading = new Set<string>();
  const evaluate = (expression: string) => runInContext(`(${expression})`, context, { timeout: 1000 }) as unknown;
  const get = (name: string): unknown => {
    if (loaded.has(name)) return loaded.get(name);
    if (loading.has(name)) throw new Error(`Circular Ketcher schema dependency: ${name}`);
    loading.add(name);
    try {
      const expression = expressions.get(name);
      if (expression === undefined && !imports.has(name)) throw new Error(`Missing Ketcher schema dependency: ${name}`);
      const result = imports.has(name) ? imports.get(name)!() : evaluate(expression!);
      loaded.set(name, result);
      return result;
    } finally { loading.delete(name); }
  };
  for (const name of new Set([...expressions.keys(), ...imports.keys()])) {
    Object.defineProperty(globals, name, { get: () => get(name) });
  }
  const exported = Object.create(null) as Record<string, unknown>;
  for (const [name, local] of exports) Object.defineProperty(exported, name, { get: () => get(local) });
  globals.exports = exported;
  return { get, evaluate, globals, exported };
}

function oneNode<T extends ts.Node>(root: ts.Node, matches: (node: ts.Node) => node is T, label: string): T {
  const found: T[] = [];
  function visit(node: ts.Node) { if (matches(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  if (found.length !== 1) throw new Error(`Expected one Ketcher ${label}, found ${found.length}`);
  return found[0];
}

function objectProperties(expression: ts.Expression): ts.PropertyAssignment[] {
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.filter(ts.isPropertyAssignment);
  if (ts.isCallExpression(expression) && expression.expression.getText().startsWith("_objectSpread")) {
    return expression.arguments.flatMap(objectProperties);
  }
  return [];
}

export function extractKetcherSchemaCatalog(
  ketcherSource: string,
  ketcherCoreSource: string,
  resolveImport: ImportResolver = createRequire(localRequire.resolve("ketcher-react")),
): { forms: SchemaEntry[]; optionsSettings: Schema } {
  const file = parse(ketcherSource);
  const core = sourceValues(parse(ketcherCoreSource), resolveImport);
  const runtime = sourceValues(file, (specifier) => specifier === "ketcher-core" ? core.exported : resolveImport(specifier));
  const formCalls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.arguments[0]?.getText(file) === "Form$1") formCalls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (formCalls.length !== 13) throw new Error(`Expected 13 Ketcher forms, found ${formCalls.length}`);
  const forms: SchemaEntry[] = [];
  for (const call of formCalls) {
    const props = objectProperties(call.arguments[1]);
    const schemaProp = props.find((property) => property.name.getText(file) === "schema");
    if (!schemaProp) throw new Error("Ketcher form no longer declares its schema");
    const name = schemaProp.initializer.getText(file);
    const custom = props.find((property) => property.name.getText(file) === "customValid")?.initializer;
    let customObject = custom;
    if (custom && ts.isIdentifier(custom)) {
      // Atom/Bond use a useMemo closure in the immediately enclosing component.
      let component: ts.Node = call;
      while (component.parent && !ts.isFunctionExpression(component) && !ts.isFunctionDeclaration(component)) component = component.parent;
      const declaration = oneNode(component, (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && node.name.getText(file) === custom.text, `${name} custom formats`);
      const returned = oneNode(declaration, (node): node is ts.ReturnStatement =>
        ts.isReturnStatement(node) && !!node.expression && ts.isObjectLiteralExpression(node.expression), `${name} format map`);
      customObject = returned.expression;
    }
    const formats = customObject ? objectProperties(customObject).map((property) => property.name.getText(file)) : [];
    if (custom && formats.length === 0) throw new Error(`Missing Ketcher custom formats: ${name}`);
    if (name === "sgroupMap[type]") {
      for (const [key, schema] of Object.entries(runtime.get("sgroupMap") as Record<string, Schema>)) {
        forms.push({ name: `sgroup:${key}`, schema, formats });
      }
    } else if (name === "enhancedStereoSchema") {
      const declaration = oneNode(file, (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && node.name.getText(file) === name, name);
      if (!declaration.initializer) throw new Error("Missing Enhanced Stereo schema initializer");
      forms.push({ name, schema: runtime.evaluate(declaration.initializer.getText(file)) as Schema, formats });
    } else if (name === "_this.saveSchema") {
      const constructor = oneNode(file, (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === "SaveDialog", "SaveDialog constructor");
      const declaration = oneNode(constructor, (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && node.name.getText(file) === "formats", "Save formats");
      const mutation = oneNode(constructor, (node): node is ts.BinaryExpression =>
        ts.isBinaryExpression(node) && node.left.getText(file) === "_this.saveSchema.properties.format", "Save format mutation");
      if (!declaration.initializer) throw new Error("Missing Save formats initializer");
      const clone = resolveImport("lodash") as { cloneDeep: (schema: unknown) => Schema };
      for (const server of [false, true]) for (const isRxn of [false, true]) {
        const schema = clone.cloneDeep(runtime.get("saveSchema"));
        runtime.globals.__save = { props: { server }, isRxn, saveSchema: schema };
        runtime.evaluate(`(() => { const _this = __save; const formats = ${declaration.initializer.getText(file)}; return (${mutation.getText(file)}); })()`);
        forms.push({ name: `save:${server ? "server" : "local"}:${isRxn ? "reaction" : "molecule"}`, schema, formats });
      }
      delete runtime.globals.__save;
    } else {
      forms.push({ name, schema: runtime.get(name) as Schema, formats });
    }
  }
  if (forms.length !== 22) throw new Error(`Expected 22 Ketcher schema variants, found ${forms.length}`);
  return { forms, optionsSettings: runtime.get("optionsSchema") as Schema };
}
