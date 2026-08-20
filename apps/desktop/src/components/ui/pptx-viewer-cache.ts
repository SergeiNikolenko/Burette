import { lruGet } from "./viewer-lru-cache";

export interface Disposable {
  dispose(): void;
  /**
   * Optional eviction guard. When it returns false the entry is "pinned" and the
   * LRU will skip it when choosing a victim (evicting the next-oldest evictable
   * entry instead, or temporarily exceeding the limit if every overflow entry is
   * pinned). Undefined is treated as always-evictable.
   */
  isEvictable?(): boolean;
}

export interface DisposableLruBudget<V> {
  maxCost: number;
  getCost(value: V): number;
}

export class DisposableLruCache<K, V extends Disposable> {
  private values = new Map<K, V>();

  constructor(
    private readonly limit: number,
    private readonly budget?: DisposableLruBudget<V>,
  ) {}

  get size() {
    return this.values.size;
  }

  get(key: K): V | undefined {
    return lruGet(this.values, key);
  }

  snapshotValues(): V[] {
    return [...this.values.values()];
  }

  set(key: K, value: V) {
    const existing = this.values.get(key);
    if (existing) existing.dispose();
    this.values.delete(key);
    this.values.set(key, value);
    this.evictExcess();
  }

  private evictExcess() {
    while (this.values.size > this.limit || this.exceedsBudget()) {
      const victim = this.oldestEvictableKey();
      // Every overflow entry is pinned (e.g. still loading); keep them all and
      // let the cache shrink back once they become evictable.
      if (victim === undefined) break;
      const dropped = this.values.get(victim);
      this.values.delete(victim);
      dropped?.dispose();
    }
  }

  private exceedsBudget() {
    return !!this.budget && this.totalCost() > this.budget.maxCost;
  }

  private totalCost() {
    if (!this.budget) return 0;
    let total = 0;
    for (const value of this.values.values()) {
      total += Math.max(0, this.budget.getCost(value));
    }
    return total;
  }

  private oldestEvictableKey(): K | undefined {
    // Map iterates in LRU order (oldest first), so the first evictable entry is
    // the least-recently-used one that is safe to drop.
    for (const [key, value] of this.values) {
      if (value.isEvictable === undefined || value.isEvictable()) return key;
    }
    return undefined;
  }

  delete(key: K) {
    const value = this.values.get(key);
    if (!value) return;
    this.values.delete(key);
    value.dispose();
  }

  clear() {
    for (const value of this.values.values()) value.dispose();
    this.values.clear();
  }
}

export class PptxBitmapEntry implements Disposable {
  constructor(readonly bitmap: ImageBitmap) {}

  get pixelCount() {
    return Math.max(0, this.bitmap.width * this.bitmap.height);
  }

  dispose() {
    this.bitmap.close();
  }
}
