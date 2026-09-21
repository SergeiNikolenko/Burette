const objectEffectKeys = new WeakMap<object, string>();
let nextObjectEffectKey = 1;

export function effectKey(value: unknown): string {
  if (value === null) return "null";

  const valueType = typeof value;
  if (valueType === "object" || valueType === "function") {
    return objectEffectKey(value as object);
  }
  if (typeof value === "string") return `string:${value.length}:${value}`;
  if (typeof value === "symbol") {
    return `symbol:${String((value as symbol).description)}`;
  }
  return `${valueType}:${String(value)}`;
}

export function joinEffectKey(parts: readonly unknown[]): string {
  return parts.map(effectKey).join("\u0000");
}

function objectEffectKey(value: object): string {
  const existingKey = objectEffectKeys.get(value);
  if (existingKey) return existingKey;

  const key = `object:${nextObjectEffectKey}`;
  nextObjectEffectKey += 1;
  objectEffectKeys.set(value, key);
  return key;
}
