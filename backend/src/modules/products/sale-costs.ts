import { EntityManager } from 'typeorm';

// A sale rung up while the product had no cost shows "—" in the margin
// reports. When the product gets a cost, give those lines that cost so
// the reports fill in (Sally, 28 Oct 2026). Lines that already carry a
// cost keep it: that's what the product cost on the day it sold.
export async function fillMissingSaleCosts(
  db: EntityManager,
  productId: number,
  cost: number | null,
): Promise<number> {
  if (cost == null || !(Number(cost) > 0)) return 0;
  const res = await db.query(
    `UPDATE order_items SET cost_price = ?
      WHERE product_id = ? AND (cost_price IS NULL OR cost_price = 0)`,
    [cost, productId],
  );
  return Number(res?.affectedRows ?? 0);
}
