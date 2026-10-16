// Sally's label stock: 89mm wide x 36mm high. Shared by the product sale
// ticket (Products > View Details > Print Ticket) and the customer ticket
// on the order screen that goes on stock waiting for collection.

export const escHtml = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

// Width in mm of `text` at `pt` points in `font` (CSS font shorthand with
// `{size}` where the size goes), measured with the browser's real font
// metrics.
let measureCtx: CanvasRenderingContext2D | null = null;
export function textWidthMm(text: string, font: string, pt: number): number {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * pt * 0.3528 * 0.6; // rough fallback
  measureCtx.font = `${font.replace('{size}', '100px')}`;
  const px = measureCtx.measureText(text).width * (pt / 75); // 100px = 75pt
  return px / 3.7795; // 96 dpi: 3.7795 px per mm
}

// Largest whole point size (between min and max) at which `text` fits
// `availMm` on one line.
export function fitPt(text: string, font: string, availMm: number, min: number, max: number): number {
  const perPt = textWidthMm(text || ' ', font, 1);
  if (!(perPt > 0)) return max;
  return Math.max(min, Math.min(max, Math.floor(availMm / perPt)));
}

// Prints one ticket from a hidden iframe holding only the ticket, so the
// job is exactly one 89 x 36 mm page whatever is on screen. (Printed from
// inside a full-screen modal the hidden POS underneath took up room and
// Chrome repeated fixed-position content on a second label — Sally,
// 12 Oct 2026.)
export function printTicketHtml(title: string, html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
    <style>@page{size:89mm 36mm;margin:0}html,body{margin:0;padding:0;background:#fff}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head>
    <body>${html}</body></html>`);
  doc.close();
  setTimeout(() => {
    win.focus();
    win.print();
    // print() blocks until the dialog closes; tidy up afterwards.
    setTimeout(() => frame.remove(), 1000);
  }, 150);
}

// Customer ticket for stock that has arrived for an order (Sally, 16 Oct
// 2026): the warehouse prints it when the backorder comes in and sticks it
// on the box, so the order can be found when the customer collects. Order
// number, customer (business first when there is one), phone and the date
// it was printed.
export type CustomerTicket = {
  orderNumber: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  printedOn: string;
};

const SANS = 'Arial, Helvetica, sans-serif';

export function customerTicketHtml(t: CustomerTicket): string {
  // Inside the 3mm side padding the label is 83mm wide.
  const dateMm = Math.max(
    textWidthMm(t.printedOn, `bold {size} ${SANS}`, 10),
    textWidthMm('PRINTED', `{size} ${SANS}`, 6.5),
  );
  const orderPt = fitPt(t.orderNumber, `bold {size} ${SANS}`, 83 - dateMm - 3, 14, 26);
  const company = (t.company || '').trim();
  const name = (t.name || '').trim();
  const showName = !!name && name.toLowerCase() !== company.toLowerCase();
  const headline = company || name || 'Walk-in customer';
  const headPt = fitPt(headline, `bold {size} ${SANS}`, 82, 9, company && showName ? 14 : 17);
  // The contact name under a business name is never bigger than it.
  const namePt = fitPt(name, `{size} ${SANS}`, 82, 8, Math.min(11, headPt));
  const line = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  return `<div style="width:89mm;height:36mm;box-sizing:border-box;padding:2mm 3mm;background:#fff;color:#000;font-family:${SANS};display:flex;flex-direction:column;justify-content:space-between;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:3mm">
      <div style="font-weight:700;font-size:${orderPt}pt;line-height:1;letter-spacing:-0.01em;${line}">${escHtml(t.orderNumber)}</div>
      <div style="text-align:right;white-space:nowrap;line-height:1.1">
        <div style="font-size:6.5pt;letter-spacing:0.08em;color:#333">PRINTED</div>
        <div style="font-size:10pt;font-weight:700">${escHtml(t.printedOn)}</div>
      </div>
    </div>
    <div>
      <div style="font-weight:700;font-size:${headPt}pt;line-height:1.1;${line}">${escHtml(headline)}</div>
      ${company && showName ? `<div style="font-size:${namePt}pt;line-height:1.15;margin-top:0.4mm;${line}">${escHtml(name)}</div>` : ''}
    </div>
    <div style="font-weight:700;font-size:15pt;line-height:1;${line}">${escHtml(t.phone || 'No phone on file')}</div>
  </div>`;
}
