type BrowserRequire = (id: string) => unknown;

function ajvEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return left !== left && right !== right;
  }
  if (left.constructor !== right.constructor) return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => ajvEqual(item, right[index]));
  }
  if (left instanceof RegExp && right instanceof RegExp) {
    return left.source === right.source && left.flags === right.flags;
  }
  const leftKeys = Object.keys(left);
  const rightRecord = right as Record<string, unknown>;
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) &&
    ajvEqual((left as Record<string, unknown>)[key], rightRecord[key]));
}

function ajvUcs2Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    length += 1;
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if ((next & 0xfc00) === 0xdc00) index += 1;
    }
  }
  return length;
}

class AjvValidationError extends Error {
  errors: unknown;
  ajv = true;
  validation = true;

  constructor(errors: unknown) {
    super("validation failed");
    this.errors = errors;
  }
}

const browserRequireModules: Record<string, unknown> = {
  "ajv/dist/runtime/equal": { default: ajvEqual },
  "ajv/dist/runtime/ucs2length": { default: ajvUcs2Length },
  "ajv/dist/runtime/uri": { default: {} },
  "ajv/dist/runtime/validation_error": { default: AjvValidationError },
};

function resolveGlobalKetcherRequireModule(id: string) {
  const globalWithKetcherLibraries = globalThis as typeof globalThis & {
    eve?: unknown;
    Raphael?: unknown;
  };
  if (id === "eve" && globalWithKetcherLibraries.eve) return globalWithKetcherLibraries.eve;
  if (id === "raphael" && globalWithKetcherLibraries.Raphael) return globalWithKetcherLibraries.Raphael;
  return undefined;
}

export function installKetcherBrowserRequire() {
  const browserRequire: BrowserRequire = (id: string) => {
    if (id in browserRequireModules) return browserRequireModules[id];
    const globalModule = resolveGlobalKetcherRequireModule(id);
    if (globalModule) return globalModule;
    throw new Error(`Unsupported browser require: ${id}`);
  };
  const globalWithRequire = globalThis as typeof globalThis & {
    require?: BrowserRequire;
    __burreteRequire?: BrowserRequire;
  };
  Object.defineProperty(globalWithRequire, "require", {
    configurable: true,
    writable: true,
    value: browserRequire,
  });
  Object.defineProperty(globalWithRequire, "__burreteRequire", {
    configurable: true,
    writable: true,
    value: browserRequire,
  });
}

function resolveDefaultModule<T>(module: T): unknown {
  return (module as T & { default?: unknown }).default ?? module;
}

export function installKetcherRaphaelBrowserModules(eveModule: unknown, raphaelModule: unknown) {
  browserRequireModules.eve = resolveDefaultModule(eveModule);
  browserRequireModules.raphael = resolveDefaultModule(raphaelModule);
}
