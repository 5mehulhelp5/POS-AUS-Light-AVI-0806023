import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDownTrayIcon,
  PlusIcon,
  PrinterIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { money, ymd } from './reportKit';

// Purchase order from Reports > Backorders (Sally, 8 Oct 2026): "convert
// all backordered items for a selected wholesaler directly into a
// purchase order, similar to the attached example. Needs to be an
// editable document so User can add to order and make relevant changes".
// Everything is editable here before it goes out, and the Excel download
// is laid out like Sally's own PO template so it can be edited again in
// Excel. Nothing is saved in the POS.

// From Sally's PO template.
const STORE = {
  name: 'Australian Lighting',
  tagline: 'So Where Ya Going?',
  street: '1704 Princes Highway',
  suburb: 'Oakleigh East Vic 3166',
  phone: '(03) 95489200',
  ordersEmail: 'orders@australianlighting.com.au',
  accountsEmail: 'sally@australianlighting.com.au',
};

export interface PoSourceLine {
  sku: string;
  name: string;
  qty: number;
  unitCostEx: number | null;
  customer: string;
  company: string | null;
  orderNumber: string;
}

interface PoLine {
  key: number;
  qty: string;
  description: string;
  cost: string; // ex GST, as typed
  reference: string;
}

// "7/10/2026" — the template's date style.
const auDate = (isoDay: string): string => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return y && m && d ? `${d}/${m}/${y}` : isoDay;
};

// Sally's numbering: her initials + the day, e.g. SA71026 = 7/10/26.
export function defaultOrderNumber(firstName: string | null | undefined, day = new Date()): string {
  const initials = (firstName || 'PO').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'PO';
  return `${initials}${day.getDate()}${day.getMonth() + 1}${String(day.getFullYear()).slice(-2)}`;
}

const num = (s: string): number => {
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

let nextKey = 1;
const toLine = (l: PoSourceLine): PoLine => ({
  key: nextKey++,
  qty: String(l.qty),
  description: !l.sku || /^custom$/i.test(l.sku) ? l.name : `${l.sku} — ${l.name}`,
  cost: l.unitCostEx != null ? l.unitCostEx.toFixed(2) : '',
  reference: `${l.company || l.customer} ${l.orderNumber}`.trim(),
});
const blankLine = (): PoLine => ({ key: nextKey++, qty: '1', description: '', cost: '', reference: '' });

export default function PurchaseOrderEditor({
  supplier,
  lines: source,
  orderedBy,
  onClose,
}: {
  supplier: string;
  lines: PoSourceLine[];
  orderedBy: string | null | undefined;
  onClose: () => void;
}) {
  const [dateOrdered, setDateOrdered] = useState(ymd(new Date()));
  const [company, setCompany] = useState(supplier === 'Unknown supplier' ? '' : supplier);
  const [orderNo, setOrderNo] = useState(defaultOrderNumber(orderedBy));
  const [lines, setLines] = useState<PoLine[]>(() => source.map(toLine));
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);

  const used = lines.filter((l) => l.description.trim() || num(l.qty) > 0);
  const totals = useMemo(() => {
    let units = 0;
    let cost = 0;
    let missing = 0;
    for (const l of lines) {
      if (!l.description.trim()) continue;
      const q = num(l.qty);
      units += q;
      if (l.cost.trim() === '') missing++;
      else cost += q * num(l.cost);
    }
    return { units, cost: Math.round(cost * 100) / 100, missing };
  }, [lines]);

  const setLine = (key: number, patch: Partial<PoLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const download = async () => {
    setBusy(true);
    try {
      await downloadXlsx({ dateOrdered, company, orderNo, lines: used });
    } catch (e: any) {
      toast.error(`Could not build the Excel file: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="bg-pos-card rounded-lg w-full max-w-5xl max-h-[94vh] overflow-auto p-6 m-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold">Purchase Order — {supplier}</h2>
            <p className="text-sm text-gray-400">
              Change anything below, add lines, then download it as Excel (editable) or print it.
            </p>
          </div>
          <button className="btn-secondary flex items-center gap-1" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" /> Close
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date ordered</label>
            <input type="date" className="input" value={dateOrdered} onChange={(e) => setDateOrdered(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Company (wholesaler)</label>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Order no.</label>
            <input className="input font-mono" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="py-2 pr-2 w-20">Qty</th>
              <th className="py-2 pr-2">Product code / description</th>
              <th className="py-2 pr-2 w-32">Cost ex GST</th>
              <th className="py-2 pr-2 w-64">Customer / reference</th>
              <th className="py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-gray-700/60 align-top">
                <td className="py-1.5 pr-2">
                  <input
                    className="input py-1 px-2 text-right"
                    inputMode="numeric"
                    value={l.qty}
                    onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="input py-1 px-2"
                    value={l.description}
                    placeholder="Code — description"
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="input py-1 px-2 text-right"
                    inputMode="decimal"
                    value={l.cost}
                    placeholder="—"
                    onChange={(e) => setLine(l.key, { cost: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="input py-1 px-2"
                    value={l.reference}
                    onChange={(e) => setLine(l.key, { reference: e.target.value })}
                  />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    className="text-gray-400 hover:text-red-500 p-1"
                    title="Remove line"
                    onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <button className="btn-secondary flex items-center gap-1" onClick={() => setLines((p) => [...p, blankLine()])}>
            <PlusIcon className="h-4 w-4" /> Add line
          </button>
          <div className="text-sm text-right">
            <span className="text-gray-400">{totals.units} units · </span>
            <span className="font-bold">Total {money(totals.cost)} ex GST</span>
            {totals.missing > 0 && (
              <span className="block text-xs text-amber-500">
                {totals.missing} line{totals.missing === 1 ? ' has' : 's have'} no cost — not in the total
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-5">
          <button className="btn-secondary flex items-center gap-2" onClick={() => setPrinting(true)} disabled={used.length === 0}>
            <PrinterIcon className="h-5 w-5" /> Print
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={download} disabled={busy || used.length === 0}>
            <ArrowDownTrayIcon className="h-5 w-5" /> {busy ? 'Building…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {printing && (
        <div className="modal-backdrop-top print:bg-white print:static" onClick={() => setPrinting(false)}>
          <div className="m-auto w-full max-w-3xl max-h-[92vh] overflow-auto print:max-h-none print:overflow-visible" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-2 mb-2 print:hidden">
              <button className="btn-primary flex items-center gap-2" onClick={() => window.print()}>
                <PrinterIcon className="h-5 w-5" /> Print
              </button>
              <button className="btn-secondary flex items-center gap-2" onClick={() => setPrinting(false)}>
                <XMarkIcon className="h-5 w-5" /> Close
              </button>
            </div>
            <div className="paper printable-root bg-white text-black rounded-lg p-8 text-sm" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <div className="flex items-stretch border-b-2 border-black pb-3">
                <div className="px-4 py-2 text-center" style={{ background: '#1e9e3e' }}>
                  <div className="font-extrabold" style={{ color: '#ffe600', fontSize: '20pt', lineHeight: 1.1 }}>{STORE.name}</div>
                  <div className="italic text-white" style={{ fontSize: '10pt' }}>{STORE.tagline}</div>
                </div>
                <div className="flex-1 flex items-center justify-center border-r-2 border-black">
                  <span className="font-extrabold italic" style={{ fontSize: '24pt' }}>PURCHASE ORDER</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 font-bold" style={{ fontSize: '11pt' }}>
                <div>
                  <div>{STORE.street}</div>
                  <div>{STORE.suburb}</div>
                </div>
                <div className="text-center">
                  <div>Ph: {STORE.phone}</div>
                  <div>Email: {STORE.ordersEmail}</div>
                  <div>Accounts: {STORE.accountsEmail}</div>
                </div>
              </div>
              <div className="mt-4 font-bold flex flex-wrap gap-x-6" style={{ fontSize: '10.5pt' }}>
                <span>DATE ORDERED: {auDate(dateOrdered)}</span>
                <span>COMPANY: {company}</span>
                <span>ORDER NO: {orderNo}</span>
              </div>
              <table className="w-full mt-3 border-collapse" style={{ fontSize: '10pt' }}>
                <thead>
                  <tr className="bg-black text-white">
                    <th className="py-1.5 px-2 text-left w-14">QTY</th>
                    <th className="py-1.5 px-2 text-left">PRODUCT CODE/DESCRIPTION</th>
                    <th className="py-1.5 px-2 text-right w-24">COST <span className="text-[8pt] italic">ex gst</span></th>
                    <th className="py-1.5 px-2 text-center w-44">CUSTOMER / REF</th>
                  </tr>
                </thead>
                <tbody>
                  {used.map((l) => (
                    <tr key={l.key} className="border border-black">
                      <td className="py-1.5 px-2 border border-black italic">{l.qty}</td>
                      <td className="py-1.5 px-2 border border-black">{l.description}</td>
                      <td className="py-1.5 px-2 border border-black text-right">{l.cost.trim() ? money(num(l.cost)) : ''}</td>
                      <td className="py-1.5 px-2 border border-black text-center">{l.reference}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 px-2 font-bold">{totals.units}</td>
                    <td className="py-1.5 px-2 text-right font-bold">TOTAL (ex GST)</td>
                    <td className="py-1.5 px-2 text-right font-bold">{money(totals.cost)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function downloadXlsx(po: { dateOrdered: string; company: string; orderNo: string; lines: PoLine[] }) {
  // Loaded on demand — keeps the spreadsheet library out of the till's bundle.
  const ExcelJS: any = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Australian Lighting POS';
  const ws = wb.addWorksheet('Purchase Order', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [{ width: 9 }, { width: 54 }, { width: 15 }, { width: 32 }];
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  // Header: logo block + title
  ws.mergeCells('A1:B3');
  const logo = ws.getCell('A1');
  logo.value = {
    richText: [
      { text: `${STORE.name}\n`, font: { name: 'Arial Black', size: 20, bold: true, color: { argb: 'FFFFE600' } } },
      { text: STORE.tagline, font: { name: 'Arial', size: 11, italic: true, color: { argb: 'FFFFFFFF' } } },
    ],
  };
  logo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E9E3E' } };
  logo.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.mergeCells('C1:D3');
  const title = ws.getCell('C1');
  title.value = 'PURCHASE ORDER';
  title.font = { name: 'Arial', size: 22, bold: true, italic: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.border = { right: { style: 'medium' }, bottom: { style: 'medium' } };
  for (const c of ['A3', 'B3']) ws.getCell(c).border = { bottom: { style: 'medium' } };
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 20;

  const bold11 = { name: 'Arial', size: 11, bold: true };
  const put = (addr: string, text: string, center = false) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = bold11;
    if (center) c.alignment = { horizontal: 'center' };
  };
  ws.mergeCells('A5:B5');
  ws.mergeCells('A6:B6');
  ws.mergeCells('C5:D5');
  ws.mergeCells('C6:D6');
  ws.mergeCells('C7:D7');
  put('A5', STORE.street);
  put('A6', STORE.suburb);
  put('C5', `Ph: ${STORE.phone}`, true);
  put('C6', `Email: ${STORE.ordersEmail}`, true);
  put('C7', `Accounts: ${STORE.accountsEmail}`, true);

  ws.mergeCells('A9:D9');
  put('A9', `DATE ORDERED: ${auDate(po.dateOrdered)}      COMPANY: ${po.company}      ORDER NO: ${po.orderNo}`);

  // Lines table
  const head = ws.getRow(11);
  head.values = ['QTY', 'PRODUCT CODE/DESCRIPTION', 'COST ex gst', 'CUSTOMER / REF'];
  head.height = 22;
  head.eachCell((c: any) => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = box;
  });

  const first = 12;
  // Spare bordered rows so the order can be added to in Excel.
  const spare = 10;
  const rows = [...po.lines.map((l) => [num(l.qty) || null, l.description, l.cost.trim() ? num(l.cost) : null, l.reference])];
  for (let i = 0; i < spare; i++) rows.push([null, '', null, '']);
  rows.forEach((vals, i) => {
    const r = ws.getRow(first + i);
    r.values = vals;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(1).font = { name: 'Arial', size: 10, italic: true };
    r.getCell(2).alignment = { vertical: 'middle', wrapText: true };
    r.getCell(3).numFmt = '$#,##0.00';
    r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let c = 1; c <= 4; c++) {
      r.getCell(c).border = box;
      if (c !== 1) r.getCell(c).font = { name: 'Arial', size: 10 };
    }
  });
  const last = first + rows.length - 1;
  const tot = ws.getRow(last + 1);
  const units = po.lines.reduce((s, l) => s + num(l.qty), 0);
  const cost = po.lines.reduce((s, l) => s + (l.cost.trim() ? num(l.qty) * num(l.cost) : 0), 0);
  tot.getCell(1).value = { formula: `SUM(A${first}:A${last})`, result: units };
  tot.getCell(2).value = 'TOTAL (ex GST)';
  tot.getCell(3).value = { formula: `SUMPRODUCT(A${first}:A${last},C${first}:C${last})`, result: Math.round(cost * 100) / 100 };
  tot.getCell(3).numFmt = '$#,##0.00';
  tot.eachCell((c: any) => (c.font = { name: 'Arial', size: 11, bold: true }));
  tot.getCell(1).alignment = { horizontal: 'center' };
  tot.getCell(2).alignment = { horizontal: 'right' };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  a.download = `PO-${safe(po.orderNo) || 'order'}-${safe(po.company) || 'supplier'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
