import { EntityManager } from 'typeorm';

// Start of the current Australian financial year (1 July, Melbourne
// time — AEST, so 30 June 14:00 UTC), as the UTC string orders use.
function financialYearStartUtc(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get('month') >= 7 ? get('year') : get('year') - 1;
  return `${year}-06-30 14:00:00`;
}

// A sale rung up while the product had no cost shows "—" in the margin
// reports. When the product gets a cost, give this financial year's
// such lines that cost so the reports fill in (Sally, 28 Oct 2026).
// Lines that already carry a cost keep it: that's what the product cost
// on the day it sold. Earlier years are left alone rather than costed
// at today's price.
export async function fillMissingSaleCosts(
  db: EntityManager,
  productId: number,
  cost: number | null,
): Promise<number> {
  if (cost == null || !(Number(cost) > 0)) return 0;
  const res = await db.query(
    `UPDATE order_items oi JOIN orders o ON o.id = oi.order_id
        SET oi.cost_price = ?
      WHERE oi.product_id = ? AND (oi.cost_price IS NULL OR oi.cost_price = 0)
        AND o.created_at >= ?`,
    [cost, productId, financialYearStartUtc()],
  );
  return Number(res?.affectedRows ?? 0);
}
