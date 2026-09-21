export const VIEWER_LRU_CACHE_MAX = 12;

export function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

export function lruSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  onEvict?: (key: K, value: V) => void,
  max = VIEWER_LRU_CACHE_MAX,
) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    const dropped = map.get(oldest);
    map.delete(oldest);
    if (dropped !== undefined) onEvict?.(oldest, dropped);
  }
}
