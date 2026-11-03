/**
 * The atom order after moving one atom row to an insertion point, as Avogadro's
 * property table does when a row is dragged (avogadrolibs PropertyView::moveAtomRow,
 * 064eeb4706877ffed8ddc4b037489ed3748b0547): `to` is between rows, 0…count.
 * Entry i is the previous index of the atom shown at row i.
 */
export function moveAtomOrder(count: number, from: number, to: number) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(from) || from < 0 || from >= count || !Number.isInteger(to) || to < 0 || to > count) {
    throw new Error("Choose an atom and a position in the atom list.");
  }
  const order = Array.from({ length: count }, (_, index) => index);
  order.splice(from, 1);
  order.splice(to > from ? to - 1 : to, 0, from);
  return order;
}
