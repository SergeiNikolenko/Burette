const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function validateName(name) {
  if (typeof name !== 'string' || !name.length || name.length > 64 || name !== name.trim() || /[\u0000-\u001f\u007f]/u.test(name)) {
    fail('INVALID_SELECTION_NAME', 'Selection name must be 1–64 characters without control characters or outer whitespace.');
  }
}

// Frozen exact addresses scoped to one viewer, not durable project definitions.
export function selectionBookmarks() {
  const entries = new Map();
  return {
    resolve(name, available) {
      validateName(name);
      const ids = entries.get(name);
      if (!ids) fail('UNKNOWN_SELECTION', 'No saved selection has this name.');
      if ([...ids].some(id => !available.has(id))) fail('STALE_SELECTION', 'Saved atom addresses no longer exist; redefine or delete this selection.');
      return new Set(ids);
    },
    list(available) {
      return [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, ids]) => {
        const availableAtoms = [...ids].filter(id => available.has(id)).length;
        return { name, atomCount: ids.size, availableAtoms, status: availableAtoms === ids.size ? 'ready' : 'stale' };
      });
    },
    save(name, ids, { overwrite, dryRun }) {
      validateName(name);
      if (overwrite !== undefined && typeof overwrite !== 'boolean') fail('INVALID_SELECTION', 'overwrite must be boolean.');
      if (entries.has(name) && overwrite !== true) fail('SELECTION_EXISTS', 'Selection already exists; explicit overwrite is required.');
      if (!entries.has(name) && entries.size >= 32) fail('SELECTION_LIMIT', 'At most 32 named selections are supported.');
      const otherCount = [...entries].reduce((sum, [key, value]) => sum + (key === name ? 0 : value.size), 0);
      if (ids.size > 10000 || otherCount + ids.size > 25000) fail('SELECTION_LIMIT', 'Named selections support 10000 atoms per name and 25000 stored addresses total; input is never truncated.');
      if (!dryRun) entries.set(name, new Set(ids));
      return { applied: !dryRun, name, atomCount: ids.size };
    },
    remove(name, dryRun) {
      validateName(name);
      if (!entries.has(name)) fail('UNKNOWN_SELECTION', 'No saved selection has this name.');
      if (!dryRun) entries.delete(name);
      return { applied: !dryRun, name };
    },
  };
}
