type ErrorRecord = Record<string, unknown>;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorRecord(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === "object" ? value as ErrorRecord : null;
}

export function normalizeAppError(error: unknown, fallback = "The operation failed."): string {
  if (error instanceof Error) return nonEmptyString(error.message) ?? fallback;
  const direct = nonEmptyString(error);
  if (direct) {
    if (direct === "[object Object]") return fallback;
    if (direct.startsWith("{") || direct.startsWith("[")) {
      try {
        return normalizeAppError(JSON.parse(direct), direct);
      } catch {
        return direct;
      }
    }
    return direct;
  }
  const record = errorRecord(error);
  if (!record) return fallback;
  const message = nonEmptyString(record.message)
    ?? nonEmptyString(record.error)
    ?? nonEmptyString(errorRecord(record.error)?.message);
  const code = nonEmptyString(record.code);
  if (message && code && !message.includes(code)) return `${message} (${code})`;
  if (message) return message;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}
