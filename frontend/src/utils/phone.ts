// Show an Australian phone number with spaces so it's easy to read off an
// invoice or the screen (Sally, 15 Oct 2026: "0401 792 240"). Numbers are
// still stored as digits; this is display only.
//   mobiles 04xx / 05xx and 13xx / 18xx -> 4-3-3   0401 792 240
//   landlines 02 / 03 / 07 / 08         -> 2-4-4   03 9548 9200
// Anything else (overseas, short, already odd) is shown as entered.
export function formatPhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('61')) d = `0${d.slice(2)}`;
  if (d.length === 10) {
    if (/^(04|05|13|18)/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    if (/^0[2378]/.test(d)) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  }
  return s;
}
