// One name per supplier, used by Reports > Backorders and the supplier
// pickers (custom items at the till, moving a backorder line to another
// supplier). "Havit Lighting - Major Stockist in Victoria", "Havit
// Lighting" and "Havit" all become "Havit".

// Brands bought through another supplier group under that supplier
// (Lucy, 16 Oct 2026: "anything that's an Aeratron fan basically, that
// is Calibo"; Sally, 20 Oct 2026: Nordlux is ordered through Form).
const SUPPLIER_OF: Record<string, string> = {
  aeratron: 'Calibo',
  nordlux: 'Form',
  // Phonix Lighting is the wholesaler PHL (Sally, 22 Oct 2026).
  phonix: 'PHL',
  'phonix lighting (phl)': 'PHL',
  phl: 'PHL',
};

// Wholesalers staff can pick for a custom item even though no supplier
// price list or brand carries their name (Sally, 22 Oct 2026: PHL).
export const ALWAYS_LISTED_SUPPLIERS = ['PHL'];

export function cleanSupplierName(s: string | null | undefined): string {
  let v = (s || '').replace(/\s+-\s+.*$/, '').trim();
  v = v.replace(/\s+(lighting|fans|lamps|costprice|for trade)$/i, '').trim();
  v = SUPPLIER_OF[v.toLowerCase()] || v;
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
}
