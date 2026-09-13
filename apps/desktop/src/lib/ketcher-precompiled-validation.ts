type Schema = Record<string, unknown>;
type ValidationError = { schemaPath: string; parentSchema?: unknown };
type Validator = ((value: unknown) => boolean) & { errors?: ValidationError[] | null };

// Presentation-only annotations are not validation rules. Functions (notably
// invalidMessage) stay on the runtime schema and are restored on verbose errors.
export function schemaIdentity(schema: unknown): string {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      const record = value as Schema;
      return Object.fromEntries(Object.keys(record).sort()
        .filter((key) => key !== "enumNames" && typeof record[key] !== "function" && record[key] !== undefined)
        .map((key) => [key, normalize(record[key])]));
    }
    return value;
  }
  return JSON.stringify(normalize(schema));
}

export function bindSchemaErrors(validate: Validator, schema: Schema): Validator {
  const wrapped: Validator = (value) => {
    const valid = validate(value);
    wrapped.errors = validate.errors?.map((error) => {
      if (!("parentSchema" in error)) return error;
      const segments = error.schemaPath.replace(/^#\//, "").split("/").slice(0, -1);
      const parentSchema = segments.reduce<unknown>((node, segment) =>
        node && typeof node === "object"
          ? (node as Schema)[segment.replace(/~1/g, "/").replace(/~0/g, "~")]
          : undefined, schema);
      return { ...error, parentSchema };
    }) ?? null;
    return valid;
  };
  return wrapped;
}
