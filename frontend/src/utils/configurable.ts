// Configurable "parent" products are $0 in the POS — the price is on each
// colour / size option. Product searches drop a parent and show its options
// instead (Sally, 16 Oct 2026 quotes; 20 Oct 2026 Add Lights showed the
// Waterfall Crystal Pendant Range at $0).
//
// Options are found by the parent's SKU (AQL-135 -> AQL-135-Black) or, when
// the codes differ (1001575 -> LOI1001574...), by the parent's name without
// its "Range" / "Series" ending (Waterfall Crystal Pendant ...).

const isParent = (p: any) => p?.productType === 'configurable';

function nameStem(name: string): string {
  return String(name || '')
    .replace(/\s+(range|series|collection|family)\b.*$/i, '')
    .trim()
    .toLowerCase();
}

function isOptionOf(p: any, parent: any): boolean {
  if (isParent(p)) return false;
  const sku = String(parent.sku || '').toLowerCase();
  const stem = nameStem(parent.name);
  const psku = String(p.sku || '').toLowerCase();
  const pname = String(p.name || '').toLowerCase();
  return (!!sku && psku.startsWith(sku)) || (stem.length >= 6 && pname.startsWith(stem));
}

export async function swapParentsForOptions(
  found: any[],
  search: (q: string) => Promise<any[]>,
  limit = 24,
): Promise<any[]> {
  let list = found.filter((p) => !isParent(p));
  for (const parent of found.filter(isParent).slice(0, 3)) {
    if (list.some((p) => isOptionOf(p, parent))) continue;
    const queries = [parent.sku, nameStem(parent.name)].filter((q) => q && String(q).length >= 3);
    for (const q of queries) {
      let more: any[] = [];
      try {
        more = await search(String(q));
      } catch {
        more = [];
      }
      const options = more.filter((p) => isOptionOf(p, parent) && !list.some((x) => x.id === p.id));
      list = [...list, ...options];
      if (options.length) break;
    }
  }
  return list.slice(0, limit);
}
