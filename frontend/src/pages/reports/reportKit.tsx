import { ReactNode, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, PrinterIcon, XMarkIcon } from '@heroicons/react/24/outline';

// ------------------------------------------------------------ formatting
export const money = (v: number | null | undefined, cents = true): string =>
  v == null || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-AU', {
        style: 'currency',
        currency: 'AUD',
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });
export const int = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString('en-AU');
export const pct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
export const change = (cur: number, prev: number): number | null =>
  prev ? ((cur - prev) / Math.abs(prev)) * 100 : cur ? null : 0;

export const dateTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
export const dateOnly = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-10-01' -> '1 Oct', '2026-10' -> 'Oct 2026', '2026' -> '2026'
export const periodLabel = (p: string, groupBy?: string): string => {
  if (/^\d{4}$/.test(p)) return p;
  if (/^\d{4}-\d{2}$/.test(p)) return `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
    const s = `${Number(p.slice(8, 10))} ${MONTHS[Number(p.slice(5, 7)) - 1]}`;
    return groupBy === 'week' ? `w/c ${s}` : s;
  }
  return p;
};

// ------------------------------------------------------------ dates
export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type Preset =
  | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  | 'last_7' | 'last_30' | 'this_fy' | 'last_fy' | 'this_year' | 'last_year' | 'custom';

export const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'last_7', label: 'Last 7 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'this_fy', label: 'This financial year' },
  { id: 'last_fy', label: 'Last financial year' },
  { id: 'this_year', label: 'This calendar year' },
  { id: 'last_year', label: 'Last calendar year' },
  { id: 'custom', label: 'Custom range' },
];

export function presetRange(p: Preset, now = new Date()): { from: string; to: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (x: Date, days: number) => new Date(x.getFullYear(), x.getMonth(), x.getDate() + days);
  const monday = add(d, -((d.getDay() + 6) % 7));
  const fyStartYear = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  switch (p) {
    case 'yesterday': return { from: ymd(add(d, -1)), to: ymd(add(d, -1)) };
    case 'this_week': return { from: ymd(monday), to: ymd(d) };
    case 'last_week': return { from: ymd(add(monday, -7)), to: ymd(add(monday, -1)) };
    case 'last_7': return { from: ymd(add(d, -6)), to: ymd(d) };
    case 'this_month': return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(d) };
    case 'last_month':
      return { from: ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: ymd(new Date(d.getFullYear(), d.getMonth(), 0)) };
    case 'last_30': return { from: ymd(add(d, -29)), to: ymd(d) };
    case 'this_fy': return { from: `${fyStartYear}-07-01`, to: ymd(d) };
    case 'last_fy': return { from: `${fyStartYear - 1}-07-01`, to: `${fyStartYear}-06-30` };
    case 'this_year': return { from: `${d.getFullYear()}-01-01`, to: ymd(d) };
    case 'last_year': return { from: `${d.getFullYear() - 1}-01-01`, to: `${d.getFullYear() - 1}-12-31` };
    default: return { from: ymd(d), to: ymd(d) };
  }
}

// ------------------------------------------------------------ CSV
export function downloadCsv(filename: string, header: string[], rows: Array<Array<unknown>>) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ------------------------------------------------------------ pieces
export function StatCard({
  label, value, sub, delta, tone,
}: { label: string; value: ReactNode; sub?: ReactNode; delta?: number | null; tone?: 'good' | 'bad' }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === 'bad' ? 'text-red-500' : tone === 'good' ? 'text-green-500' : ''}`}>{value}</p>
      {(sub || delta != null) && (
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
          {delta != null && (
            <span className={`font-semibold ${delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {sub}
        </p>
      )}
    </div>
  );
}

export function Bars<T>({
  rows, value, label, fmt = (v: number) => int(v), height = 160,
}: { rows: T[]; value: (r: T) => number; label: (r: T) => string; fmt?: (v: number) => string; height?: number }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(0, value(r))));
  if (!rows.length) return <p className="text-sm text-gray-400 py-6 text-center">No data in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-w-full" style={{ height }}>
        {rows.map((r, i) => {
          const v = value(r);
          const h = Math.max(2, (Math.max(0, v) / max) * (height - 24));
          return (
            <div key={i} className="flex-1 min-w-[18px] flex flex-col items-center justify-end h-full group" title={`${label(r)}: ${fmt(v)}`}>
              <div className="w-full rounded-t bg-primary-500/80 group-hover:bg-primary-500" style={{ height: h }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 min-w-full mt-1">
        {rows.map((r, i) => (
          <div key={i} className="flex-1 min-w-[18px] text-[10px] text-gray-400 text-center truncate">
            {rows.length <= 16 || i % Math.ceil(rows.length / 16) === 0 ? label(r) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface Col<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null | undefined; // for sorting + CSV
}

export function DataTable<T>({
  title, columns, rows, csvName, onRowClick, empty = 'Nothing to show for this range.', maxHeight, initialSort,
}: {
  title?: ReactNode;
  columns: Col<T>[];
  rows: T[];
  csvName?: string;
  onRowClick?: (row: T) => void;
  empty?: string;
  maxHeight?: number;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const get = col.value;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      const cmp = typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);
  return (
    <div className="card overflow-hidden">
      {(title || csvName) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-700">
          <div className="font-semibold">{title}</div>
          {csvName && rows.length > 0 && (
            <button
              className="btn-secondary text-xs py-1 flex items-center gap-1"
              onClick={() =>
                downloadCsv(
                  csvName,
                  columns.map((c) => c.label),
                  sorted.map((r) => columns.map((c) => (c.value ? c.value(r) : ''))),
                )
              }
            >
              <ArrowDownTrayIcon className="h-4 w-4" /> CSV
            </button>
          )}
        </div>
      )}
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-sm">
          <thead className="bg-pos-accent sticky top-0">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium text-gray-300 whitespace-nowrap ${
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                  } ${c.value ? 'cursor-pointer select-none hover:text-pos-text' : ''}`}
                  onClick={() =>
                    c.value &&
                    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' }))
                  }
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-400">{empty}</td>
              </tr>
            ) : (
              sorted.map((r, i) => (
                <tr
                  key={i}
                  className={onRowClick ? 'cursor-pointer hover:bg-pos-accent/50' : ''}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''}`}
                    >
                      {c.render ? c.render(r) : String(c.value ? c.value(r) ?? '' : '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// White "paper" sheet in a modal; Print sends only the sheet to the
// printer (printable-root isolation in index.css).
export function PrintSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop-top print:bg-white print:static" onClick={onClose}>
      <div className="m-auto w-full max-w-3xl max-h-[92vh] overflow-auto print:max-h-none print:overflow-visible" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-2 mb-2 print:hidden">
          <button className="btn-primary flex items-center gap-2" onClick={() => window.print()}>
            <PrinterIcon className="h-5 w-5" /> Print
          </button>
          <button className="btn-secondary flex items-center gap-2" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" /> Close
          </button>
        </div>
        <div className="paper printable-root bg-white text-black rounded-lg p-8 text-sm">
          <h2 className="text-xl font-bold mb-1">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
