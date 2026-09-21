// Reserve decoded RGBA storage before rendering. Keep existing movies intact
// rather than evicting/restarting them when another item is selected.
export function createAnimationBudget(maxPixels = 200_000_000) {
  const reservations = new Map<string, number>();
  return (key: string, pixels: number) => {
    if (pixels === 0) { reservations.delete(key); return true; }
    if (!Number.isSafeInteger(pixels) || pixels < 0) return false;
    let total = pixels;
    for (const [other, amount] of reservations) if (other !== key) total += amount;
    if (total > maxPixels) return false;
    reservations.set(key, pixels);
    return true;
  };
}
