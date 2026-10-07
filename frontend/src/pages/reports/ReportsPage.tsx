import { ReactNode, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { reportsApi, ReportRange } from '../../services/api';
import {
  money, int, pct, change, dateTime, dateOnly, periodLabel, presetRange, PRESETS, Preset,
  StatCard, Bars, DataTable, PrintSheet, downloadCsv, Col,
} from './reportKit';

// Reports suite (Sally, Oct 2026). Every tab reads the same filter bar
// except End of Day (the till since its last close) and Backorders
// (everything still open).
type Tab =
  | 'eod' | 'summary' | 'pl' | 'clearance' | 'items' | 'trade' | 'staff' | 'customers' | 'backorders'
  | 'discounts' | 'quotes';

const TABS: Array<{ id: Tab; label: string; filters: boolean; groupBy?: boolean }> = [
  { id: 'eod', label: 'End of Day', filters: false },
  { id: 'summary', label: 'Sales Summary', filters: true, groupBy: true },
  { id: 'pl', label: 'Profit & Loss', filters: true, groupBy: true },
  { id: 'clearance', label: 'Clearance', filters: true, groupBy: true },
  { id: 'items', label: 'Sales by Item', filters: true },
  { id: 'trade', label: 'Trade', filters: true, groupBy: true },
  { id: 'staff', label: 'Sales by Staff', filters: true },
  { id: 'customers', label: 'Customers', filters: true },
  { id: 'backorders', label: 'Backorders', filters: false },
  { id: 'discounts', label: 'Discounts', filters: true },
  { id: 'quotes', label: 'Quotes', filters: true },
];

const CHANNELS: Array<{ id: NonNullable<ReportRange['channel']>; label: string }> = [
  { id: 'store', label: 'In-store (POS + old invoices)' },
  { id: 'pos', label: 'POS only' },
  { id: 'web', label: 'Website orders' },
  { id: 'all', label: 'All channels' },
];

const errMsg = (e: any) => e?.response?.data?.message || e?.message || 'Could not load the report';

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('eod');
  const [preset, setPreset] = useState<Preset>('this_month');
  const [range, setRange] = useState(() => presetRange('this_month'));
  const [channel, setChannel] = useState<NonNullable<ReportRange['channel']>>('store');
  const [groupBy, setGroupBy] = useState<'auto' | 'day' | 'week' | 'month' | 'year'>('auto');
  const [historyFor, setHistoryFor] = useState<number | null>(null);

  const meta = TABS.find((t) => t.id === tab)!;
  const params: ReportRange = {
    from: range.from,
    to: range.to,
    channel,
    ...(groupBy !== 'auto' ? { groupBy } : {}),
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              tab === t.id ? 'bg-primary-600 text-white' : 'bg-pos-accent text-gray-300 hover:text-pos-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {meta.filters && (
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Period</label>
            <select
              className="input w-52"
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset;
                setPreset(p);
                if (p !== 'custom') setRange(presetRange(p));
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input type="date" className="input w-40" value={range.from}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input type="date" className="input w-40" value={range.to}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} />
          </div>
          {tab !== 'discounts' && tab !== 'quotes' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Sales from</label>
              <select className="input w-60" value={channel} onChange={(e) => setChannel(e.target.value as any)}>
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
          {meta.groupBy && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Group by</label>
              <select className="input w-32" value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
                <option value="auto">Auto</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
          )}
        </div>
      )}

      {tab === 'eod' && <EndOfDay />}
      {tab === 'summary' && <SalesSummary params={params} />}
      {tab === 'pl' && <ProfitLoss params={params} />}
      {tab === 'clearance' && <Clearance params={params} />}
      {tab === 'items' && <SalesByItem params={params} />}
      {tab === 'trade' && <Trade params={params} onCustomer={setHistoryFor} />}
      {tab === 'staff' && <Staff params={params} />}
      {tab === 'customers' && <Customers params={params} onCustomer={setHistoryFor} />}
      {tab === 'backorders' && <Backorders />}
      {tab === 'discounts' && <Discounts params={params} />}
      {tab === 'quotes' && <Quotes params={params} />}

      {historyFor != null && <CustomerHistory id={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

// ------------------------------------------------------------ data hook
function useReport<T>(load: () => Promise<any>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((r) => { if (!cancelled) setData(r.data?.data ?? null); })
      .catch((e) => { if (!cancelled) setError(errMsg(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  return { data, loading, error, reload };
}

function State({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <div className="card p-6 text-red-400">{error}</div>;
  if (loading) return <div className="card p-6 text-gray-400">Loading…</div>;
  return <>{children}</>;
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-xs text-gray-400">{children}</p>;

// ============================================================ END OF DAY
type EodTotals = {
  transactions: number; gross: number; discounts: number; tax: number; delivery: number;
  byCustomerType: Array<{ type: string; transactions: number; total: number }>;
  bySaleType: Array<{ type: string; transactions: number; total: number }>;
  payments: Array<{ method: string; count: number; amount: number }>;
  paymentsTotal: number;
  refunds: { count: number; amount: number; cash: number; storeCredit: number };
  netTakings: number; cashExpected: number;
};
type DayCloseRow = {
  id: number; openedAt: string; closedAt: string; closedByName: string | null;
  cashCounted: number | null; cashDifference: number | null; notes: string | null; totals: EodTotals;
};
const METHOD: Record<string, string> = {
  cash: 'Cash', eftpos: 'EFTPOS', credit_card: 'Credit card', bank_transfer: 'Bank transfer',
  store_credit: 'Store credit', other: 'Other',
};

function EodBreakdown({ t }: { t: EodTotals }) {
  const row = (label: string, value: ReactNode, strong = false) => (
    <div className={`flex justify-between py-1 ${strong ? 'font-bold border-t border-gray-300 mt-1 pt-2' : ''}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h4 className="font-semibold mb-1">Sales</h4>
        {row('Transactions', int(t.transactions))}
        {row('Gross sales (inc GST)', money(t.gross))}
        {row('Discounts given', money(t.discounts))}
        {row('GST collected', money(t.tax))}
        {row('Delivery fees', money(t.delivery))}
        <h4 className="font-semibold mt-4 mb-1">Customer type</h4>
        {t.byCustomerType.length === 0 && <p className="text-gray-500">No sales.</p>}
        {t.byCustomerType.map((x) => row(`${x.type} (${x.transactions})`, money(x.total)))}
        <h4 className="font-semibold mt-4 mb-1">Sale type</h4>
        {t.bySaleType.length === 0 && <p className="text-gray-500">No sales.</p>}
        {t.bySaleType.map((x) => row(`${x.type} (${x.transactions})`, money(x.total)))}
      </div>
      <div>
        <h4 className="font-semibold mb-1">Payments taken</h4>
        {t.payments.length === 0 && <p className="text-gray-500">No payments.</p>}
        {t.payments.map((p) => row(`${METHOD[p.method] || p.method} (${p.count})`, money(p.amount)))}
        {row('Total payments', money(t.paymentsTotal), true)}
        <h4 className="font-semibold mt-4 mb-1">Refunds</h4>
        {row(`Refunds given (${t.refunds.count})`, money(t.refunds.amount))}
        {row('— paid in cash', money(t.refunds.cash))}
        {row('— as store credit', money(t.refunds.storeCredit))}
        {row('Net takings (payments less cash refunds)', money(t.netTakings), true)}
        {row('Cash expected in drawer', money(t.cashExpected), true)}
      </div>
    </div>
  );
}

function EndOfDay() {
  const { data, loading, error, reload } = useReport<{ window: { start: string; end: string }; lastClose: any; totals: EodTotals }>(
    () => reportsApi.eod(), [],
  );
  const hist = useReport<DayCloseRow[]>(() => reportsApi.eodHistory(60), []);
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState<DayCloseRow | null>(null);

  const close = async () => {
    if (!data) return;
    const t = data.totals;
    if (!window.confirm(
      `Close the day?\n\n${int(t.transactions)} transactions, ${money(t.gross)} sales, ${money(t.paymentsTotal)} taken.\n\n` +
      'The totals are saved and the End of Day starts again from zero.',
    )) return;
    const c = cash.trim() === '' ? null : Number(cash);
    if (c != null && (!Number.isFinite(c) || c < 0)) { toast.error('Cash counted must be a number'); return; }
    setClosing(true);
    try {
      const r = await reportsApi.closeDay({ cashCounted: c, notes: notes.trim() || undefined });
      toast.success('Day closed');
      setCash(''); setNotes('');
      setPrinting(r.data.data);
      reload(); hist.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setClosing(false);
    }
  };

  return (
    <State loading={loading && !data} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">POS till since {dateTime(data.window.start)}</p>
              <Note>
                {data.lastClose
                  ? `Last closed ${dateTime(data.lastClose.closedAt)}${data.lastClose.closedByName ? ` by ${data.lastClose.closedByName}` : ''}.`
                  : 'Not closed before — counting from the start of today.'}{' '}
                Sales are counted when placed; payments and refunds when taken.
              </Note>
            </div>
            <button className="btn-secondary text-sm" onClick={() => { reload(); hist.reload(); }}>Refresh</button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard label="Transactions" value={int(data.totals.transactions)} />
            <StatCard label="Gross sales" value={money(data.totals.gross)} />
            <StatCard label="Payments taken" value={money(data.totals.paymentsTotal)} />
            <StatCard label="Refunds" value={money(data.totals.refunds.amount)} sub={`${data.totals.refunds.count} refunds`} />
            <StatCard label="Net takings" value={money(data.totals.netTakings)} />
            <StatCard label="Cash in drawer" value={money(data.totals.cashExpected)} sub="expected" />
          </div>

          <div className="card p-5"><EodBreakdown t={data.totals} /></div>

          <div className="card p-5">
            <h3 className="font-semibold mb-3">Close the day</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cash counted (optional)</label>
                <input type="number" step="0.05" min={0} className="input w-40" value={cash}
                  onChange={(e) => setCash(e.target.value)} placeholder={data.totals.cashExpected.toFixed(2)} />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                <input type="text" className="input w-full" value={notes} maxLength={500}
                  onChange={(e) => setNotes(e.target.value)} placeholder="e.g. $20 float left in drawer" />
              </div>
              <button className="btn-primary" disabled={closing} onClick={close}>
                {closing ? 'Closing…' : 'Close Day'}
              </button>
            </div>
            {cash.trim() !== '' && Number.isFinite(Number(cash)) && (
              <p className={`text-sm mt-2 ${Math.abs(Number(cash) - data.totals.cashExpected) < 0.005 ? 'text-green-500' : 'text-amber-500'}`}>
                Difference: {money(Number(cash) - data.totals.cashExpected)}
              </p>
            )}
          </div>

          <DataTable<DayCloseRow>
            title="Previous day closes"
            csvName="day-closes.csv"
            rows={hist.data || []}
            empty="No days closed yet."
            onRowClick={(r) => setPrinting(r)}
            columns={[
              { key: 'closed', label: 'Closed', render: (r) => dateTime(r.closedAt), value: (r) => r.closedAt },
              { key: 'by', label: 'By', value: (r) => r.closedByName || '' },
              { key: 'tx', label: 'Transactions', align: 'right', value: (r) => r.totals.transactions, render: (r) => int(r.totals.transactions) },
              { key: 'gross', label: 'Sales', align: 'right', value: (r) => r.totals.gross, render: (r) => money(r.totals.gross) },
              { key: 'taken', label: 'Payments', align: 'right', value: (r) => r.totals.paymentsTotal, render: (r) => money(r.totals.paymentsTotal) },
              { key: 'exp', label: 'Cash expected', align: 'right', value: (r) => r.totals.cashExpected, render: (r) => money(r.totals.cashExpected) },
              { key: 'cnt', label: 'Cash counted', align: 'right', value: (r) => r.cashCounted ?? '', render: (r) => money(r.cashCounted) },
              {
                key: 'diff', label: 'Difference', align: 'right', value: (r) => r.cashDifference ?? '',
                render: (r) => r.cashDifference == null ? '—' : (
                  <span className={Math.abs(r.cashDifference) < 0.005 ? 'text-green-500' : 'text-amber-500'}>{money(r.cashDifference)}</span>
                ),
              },
            ]}
          />
          <Note>Click a past close to view or reprint it.</Note>

          {printing && (
            <PrintSheet title="End of Day — Z Report" onClose={() => setPrinting(null)}>
              <p className="mb-4 text-gray-600">
                Australian Lighting & Fans · {dateTime(printing.openedAt)} to {dateTime(printing.closedAt)}
                {printing.closedByName ? ` · closed by ${printing.closedByName}` : ''}
              </p>
              <EodBreakdown t={printing.totals} />
              <div className="mt-4 border-t border-gray-300 pt-2">
                <div className="flex justify-between"><span>Cash counted</span><span>{money(printing.cashCounted)}</span></div>
                <div className="flex justify-between font-bold"><span>Difference</span><span>{money(printing.cashDifference)}</span></div>
                {printing.notes && <p className="mt-2">Notes: {printing.notes}</p>}
              </div>
            </PrintSheet>
          )}
        </div>
      )}
    </State>
  );
}

// ============================================================ SALES SUMMARY
type Totals = {
  transactions: number; gross: number; discounts: number; tax: number; delivery: number; refunds: number;
  refundTotal: number; net: number; netExGst: number; averageSale: number; tradeTransactions: number; tradeSales: number;
};
type Summary = {
  range: { from: string; to: string; groupBy: string };
  previousRange: { from: string; to: string };
  current: Totals; previous: Totals;
  series: Array<{ period: string; transactions: number; gross: number; refunds: number; net: number }>;
};

function SummaryCards({ s }: { s: Summary }) {
  const c = s.current, p = s.previous;
  const vs = `vs ${dateOnly(s.previousRange.from)} – ${dateOnly(s.previousRange.to)}`;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Net sales" value={money(c.net)} delta={change(c.net, p.net)} sub={`${money(p.net)} before`} />
        <StatCard label="Transactions" value={int(c.transactions)} delta={change(c.transactions, p.transactions)} sub={`${int(p.transactions)} before`} />
        <StatCard label="Average sale" value={money(c.averageSale)} delta={change(c.averageSale, p.averageSale)} sub={`${money(p.averageSale)} before`} />
        <StatCard label="Refunds" value={money(c.refundTotal)} sub={`${c.refunds} refunds · ${money(p.refundTotal)} before`} />
        <StatCard label="Gross sales" value={money(c.gross)} delta={change(c.gross, p.gross)} />
        <StatCard label="Net sales ex GST" value={money(c.netExGst)} delta={change(c.netExGst, p.netExGst)} />
        <StatCard label="GST collected" value={money(c.tax)} />
        <StatCard label="Discounts given" value={money(c.discounts)} />
      </div>
      <Note>Compared with the previous period of the same length ({vs}).</Note>
    </>
  );
}

function SalesSummary({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<Summary>(() => reportsApi.summary(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <SummaryCards s={data} />
          <div className="card p-4">
            <p className="font-semibold mb-3">Net sales by {data.range.groupBy}</p>
            <Bars rows={data.series} value={(r) => r.net} label={(r) => periodLabel(r.period, data.range.groupBy)} fmt={(v) => money(v)} />
          </div>
          <DataTable
            title="By period"
            csvName={`sales-summary-${data.range.from}-to-${data.range.to}.csv`}
            rows={data.series}
            columns={[
              { key: 'p', label: 'Period', value: (r) => r.period, render: (r) => periodLabel(r.period, data.range.groupBy) },
              { key: 't', label: 'Transactions', align: 'right', value: (r) => r.transactions, render: (r) => int(r.transactions) },
              { key: 'g', label: 'Gross sales', align: 'right', value: (r) => r.gross, render: (r) => money(r.gross) },
              { key: 'r', label: 'Refunds', align: 'right', value: (r) => r.refunds, render: (r) => money(r.refunds) },
              { key: 'n', label: 'Net sales', align: 'right', value: (r) => r.net, render: (r) => money(r.net) },
            ]}
          />
        </div>
      )}
    </State>
  );
}

// ============================================================ P&L
function ProfitLoss({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any>(() => reportsApi.profitLoss(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (() => {
        const t = data.totals;
        const line = (label: string, value: ReactNode, opts: { strong?: boolean; indent?: boolean } = {}) => (
          <div className={`flex justify-between py-1.5 ${opts.strong ? 'font-bold border-t border-gray-700 mt-1 pt-2' : ''} ${opts.indent ? 'pl-4 text-gray-400' : ''}`}>
            <span>{label}</span><span className="tabular-nums">{value}</span>
          </div>
        );
        return (
          <div className="space-y-4">
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="card p-5 lg:col-span-2">
                <p className="font-semibold mb-2">Profit & loss, {dateOnly(data.range.from)} – {dateOnly(data.range.to)} (ex GST)</p>
                {line('Sales', money(t.salesExGst))}
                {line('includes delivery fees', money(t.deliveryExGst), { indent: true })}
                {line('Less refunds', money(-t.refundsExGst))}
                {line('Net sales', money(t.netSalesExGst), { strong: true })}
                {line('Sales of items with a cost on file', money(t.costedSalesExGst))}
                {line('Less cost of goods sold', money(-t.cogsExGst))}
                {line('Gross profit (on items with a cost)', money(t.grossProfit), { strong: true })}
                {line('Gross margin', pct(t.marginPct))}
                {line('Sales with no cost on file (not in gross profit)', money(t.uncostedSalesExGst), { indent: true })}
              </div>
              <div className="space-y-3">
                <StatCard label="Gross profit" value={money(t.grossProfit)} tone={t.grossProfit < 0 ? 'bad' : undefined} />
                <StatCard label="Gross margin" value={pct(t.marginPct)} />
                <StatCard label="Cost coverage" value={pct(t.costCoveragePct)} sub="of sales have a cost price" />
              </div>
            </div>
            <Note>
              Gross profit only — rent, wages and other expenses aren't in the POS. Cost is the product's cost price at the time of sale;
              refunded items put back on the shelf return their cost. Old imported invoices have no cost, so they show in sales but not in gross profit.
            </Note>
            <DataTable
              title={`By ${data.range.groupBy}`}
              csvName={`profit-loss-${data.range.from}-to-${data.range.to}.csv`}
              rows={data.rows}
              columns={[
                { key: 'p', label: 'Period', value: (r: any) => r.period, render: (r: any) => periodLabel(r.period, data.range.groupBy) },
                { key: 'tx', label: 'Transactions', align: 'right', value: (r: any) => r.transactions, render: (r: any) => int(r.transactions) },
                { key: 's', label: 'Sales ex GST', align: 'right', value: (r: any) => r.salesExGst, render: (r: any) => money(r.salesExGst) },
                { key: 'r', label: 'Refunds', align: 'right', value: (r: any) => r.refundsExGst, render: (r: any) => money(r.refundsExGst) },
                { key: 'n', label: 'Net sales', align: 'right', value: (r: any) => r.netSalesExGst, render: (r: any) => money(r.netSalesExGst) },
                { key: 'c', label: 'COGS', align: 'right', value: (r: any) => r.cogsExGst, render: (r: any) => money(r.cogsExGst) },
                { key: 'gp', label: 'Gross profit', align: 'right', value: (r: any) => r.grossProfit, render: (r: any) => money(r.grossProfit) },
                { key: 'm', label: 'Margin', align: 'right', value: (r: any) => r.marginPct ?? '', render: (r: any) => pct(r.marginPct) },
                { key: 'cov', label: 'Cost coverage', align: 'right', value: (r: any) => r.costCoveragePct ?? '', render: (r: any) => pct(r.costCoveragePct) },
              ]}
            />
          </div>
        );
      })()}
    </State>
  );
}

// ============================================================ CLEARANCE
function Clearance({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any>(() => reportsApi.clearance(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Clearance units sold" value={int(data.totals.units)} />
            <StatCard label="Clearance revenue" value={money(data.totals.revenue)} />
            <StatCard label="Orders with clearance" value={int(data.totals.orders)} />
            <StatCard label="Different products" value={int(data.totals.products)} />
          </div>
          <div className="card p-4">
            <p className="font-semibold mb-3">Units sold by {data.range.groupBy}</p>
            <Bars rows={data.series} value={(r: any) => r.units} label={(r: any) => periodLabel(r.period, data.range.groupBy)} />
          </div>
          <DataTable
            title="Top 10 clearance products"
            csvName={`clearance-top10-${data.range.from}-to-${data.range.to}.csv`}
            rows={data.top}
            columns={[
              { key: 'sku', label: 'SKU', value: (r: any) => r.sku },
              { key: 'n', label: 'Product', value: (r: any) => r.name },
              { key: 'u', label: 'Units sold', align: 'right', value: (r: any) => r.units, render: (r: any) => int(r.units) },
              { key: 'rev', label: 'Revenue', align: 'right', value: (r: any) => r.revenue, render: (r: any) => money(r.revenue) },
              { key: 'st', label: 'Still in stock', align: 'right', value: (r: any) => r.stock, render: (r: any) => int(r.stock) },
            ]}
          />
          <Note>Counts products that sit in a Clearance category on the website. Old imported invoices aren't linked to products, so they aren't included.</Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ BY ITEM
type ItemRow = {
  productId: number | null; sku: string; name: string; units: number; orders: number; revenue: number;
  revenueExGst: number; costExGst: number | null; marginExGst: number | null; marginPct: number | null;
};
const itemColumns: Col<ItemRow>[] = [
  { key: 'sku', label: 'SKU', value: (r) => r.sku },
  { key: 'name', label: 'Product', value: (r) => r.name },
  { key: 'units', label: 'Units', align: 'right', value: (r) => r.units, render: (r) => int(r.units) },
  { key: 'orders', label: 'Orders', align: 'right', value: (r) => r.orders, render: (r) => int(r.orders) },
  { key: 'rev', label: 'Revenue (inc GST)', align: 'right', value: (r) => r.revenue, render: (r) => money(r.revenue) },
  { key: 'cost', label: 'Cost ex GST', align: 'right', value: (r) => r.costExGst ?? '', render: (r) => money(r.costExGst) },
  { key: 'm', label: 'Margin ex GST', align: 'right', value: (r) => r.marginExGst ?? '', render: (r) => money(r.marginExGst) },
  {
    key: 'mp', label: 'Margin %', align: 'right', value: (r) => r.marginPct ?? '',
    render: (r) => <span className={r.marginPct != null && r.marginPct < 16.7 ? 'text-amber-500' : ''}>{pct(r.marginPct)}</span>,
  },
];

function SalesByItem({ params }: { params: ReportRange }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 400); return () => clearTimeout(t); }, [search]);
  const key = JSON.stringify(params) + q;
  const { data, loading, error } = useReport<{ items: ItemRow[]; unitemised: { lines: number; revenue: number } }>(
    () => reportsApi.items({ ...params, search: q || undefined, limit: 2000 }), [key],
  );
  return (
    <div className="space-y-3">
      <input className="input w-full md:w-96" placeholder="Filter by SKU or product name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <State loading={loading} error={error}>
        {data && (
          <>
            <DataTable
              title={`${int(data.items.length)} products`}
              csvName={`sales-by-item-${params.from}-to-${params.to}.csv`}
              rows={data.items}
              columns={itemColumns}
              maxHeight={620}
            />
            <Note>
              Margin uses the cost price at the time of sale; products with no cost show a dash.
              {data.unitemised.lines > 0 &&
                ` ${int(data.unitemised.lines)} lines from old imported invoices (${money(data.unitemised.revenue)}) have no product code and aren't itemised.`}
              {' '}Showing up to 2,000 products, highest revenue first. Click a column to sort.
            </Note>
          </>
        )}
      </State>
    </div>
  );
}

// ============================================================ TRADE
type CustomerRow = {
  id: number; name: string; company: string | null; phone: string | null; isTrade: boolean;
  orders: number; revenue: number; averageOrder: number; lastPurchase: string | null;
};
const customerColumns = (showTrade: boolean): Col<CustomerRow>[] => [
  {
    key: 'name', label: 'Customer', value: (r) => r.name,
    render: (r) => (
      <span className="flex items-center gap-2">
        {r.name || '—'}
        {showTrade && r.isTrade && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-600/30 text-orange-300">Trade</span>}
      </span>
    ),
  },
  { key: 'company', label: 'Company', value: (r) => r.company || '' },
  { key: 'phone', label: 'Phone', value: (r) => r.phone || '' },
  { key: 'orders', label: 'Orders', align: 'right', value: (r) => r.orders, render: (r) => int(r.orders) },
  { key: 'rev', label: 'Spend', align: 'right', value: (r) => r.revenue, render: (r) => money(r.revenue) },
  { key: 'avg', label: 'Average order', align: 'right', value: (r) => r.averageOrder, render: (r) => money(r.averageOrder) },
  { key: 'last', label: 'Last purchase', value: (r) => r.lastPurchase || '', render: (r) => dateOnly(r.lastPurchase) },
];

function Trade({ params, onCustomer }: { params: ReportRange; onCustomer: (id: number) => void }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<{ summary: Summary; customers: CustomerRow[]; products: ItemRow[] }>(
    () => reportsApi.trade(params), [key],
  );
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <SummaryCards s={data.summary} />
          <div className="card p-4">
            <p className="font-semibold mb-3">Trade sales by {data.summary.range.groupBy}</p>
            <Bars rows={data.summary.series} value={(r) => r.net} label={(r) => periodLabel(r.period, data.summary.range.groupBy)} fmt={(v) => money(v)} />
          </div>
          <DataTable
            title="Best trade customers"
            csvName={`trade-customers-${params.from}-to-${params.to}.csv`}
            rows={data.customers}
            columns={customerColumns(false)}
            onRowClick={(r) => onCustomer(r.id)}
          />
          <DataTable
            title="Top products sold to trade"
            csvName={`trade-products-${params.from}-to-${params.to}.csv`}
            rows={data.products}
            columns={itemColumns}
          />
          <Note>
            Trade is recorded on every sale from 7 Oct 2026. Earlier sales count as trade only if the customer is marked trade,
            so older periods will undercount. Click a customer to see their purchase history.
          </Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ STAFF
function Staff({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any[]>(() => reportsApi.staff(params), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-2">
          <DataTable
            title="Sales by staff member"
            csvName={`sales-by-staff-${params.from}-to-${params.to}.csv`}
            rows={data}
            columns={[
              { key: 'n', label: 'Staff member', value: (r: any) => r.name },
              { key: 't', label: 'Transactions', align: 'right', value: (r: any) => r.transactions, render: (r: any) => int(r.transactions) },
              { key: 'rev', label: 'Revenue', align: 'right', value: (r: any) => r.revenue, render: (r: any) => money(r.revenue) },
              { key: 'avg', label: 'Average sale', align: 'right', value: (r: any) => r.averageSale, render: (r: any) => money(r.averageSale) },
              { key: 'd', label: 'Discounts given', align: 'right', value: (r: any) => r.discounts, render: (r: any) => money(r.discounts) },
              { key: 'tt', label: 'Trade sales', align: 'right', value: (r: any) => r.tradeTransactions, render: (r: any) => int(r.tradeTransactions) },
              { key: 'rf', label: 'Refunds given', align: 'right', value: (r: any) => r.refundAmount, render: (r: any) => `${money(r.refundAmount)} (${r.refunds})` },
            ]}
          />
          <Note>Sales are credited to whoever was logged in when the sale was put through. Old imported invoices are shown as one line.</Note>
        </div>
      )}
    </State>
  );
}

// ============================================================ CUSTOMERS
function Customers({ params, onCustomer }: { params: ReportRange; onCustomer: (id: number) => void }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<CustomerRow[]>(() => reportsApi.customers({ ...params, limit: 200 }), [key]);
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-2">
          <DataTable
            title="Top customers by spend"
            csvName={`top-customers-${params.from}-to-${params.to}.csv`}
            rows={data}
            columns={customerColumns(true)}
            onRowClick={(r) => onCustomer(r.id)}
            maxHeight={620}
          />
          <Note>Top 200 named customers in the period. Walk-in sales with no customer aren't included. Click a customer for their full purchase history.</Note>
        </div>
      )}
    </State>
  );
}

const SOURCE: Record<string, string> = { pos: 'POS', magento: 'Website', legacy: 'Old invoice' };

function CustomerHistory({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, loading, error } = useReport<any>(() => reportsApi.customerHistory(id), [id]);
  return (
    <div className="modal-backdrop-top" onClick={onClose}>
      <div className="m-auto w-full max-w-4xl max-h-[90vh] overflow-auto card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4 gap-3">
          <div>
            <h2 className="text-xl font-bold">{data?.customer?.name || 'Customer'}</h2>
            <p className="text-sm text-gray-400">
              {[data?.customer?.company, data?.customer?.phone, data?.customer?.email].filter(Boolean).join(' · ')}
              {data?.customer?.isTrade ? ' · Trade' : ''}
            </p>
          </div>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <State loading={loading} error={error}>
          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Lifetime spend" value={money(data.summary.lifetimeSpend)} sub="after refunds" />
                <StatCard label="Orders" value={int(data.summary.orders)} />
                <StatCard label="First purchase" value={<span className="text-base">{dateOnly(data.summary.firstPurchase)}</span>} />
                <StatCard label="Last purchase" value={<span className="text-base">{dateOnly(data.summary.lastPurchase)}</span>} />
              </div>
              <DataTable
                title="Purchase history"
                csvName={`customer-${id}-history.csv`}
                rows={data.orders}
                maxHeight={420}
                columns={[
                  { key: 'd', label: 'Date', value: (r: any) => r.createdAt, render: (r: any) => dateOnly(r.createdAt) },
                  { key: 'n', label: 'Order', value: (r: any) => r.orderNumber },
                  { key: 's', label: 'From', value: (r: any) => SOURCE[r.source] || r.source },
                  { key: 'st', label: 'Status', value: (r: any) => r.status.replace(/_/g, ' ') },
                  { key: 'i', label: 'Items', align: 'right', value: (r: any) => r.items },
                  { key: 't', label: 'Total', align: 'right', value: (r: any) => r.total, render: (r: any) => money(r.total) },
                  { key: 'r', label: 'Refunded', align: 'right', value: (r: any) => r.refunded, render: (r: any) => (r.refunded ? money(r.refunded) : '') },
                ]}
              />
            </div>
          )}
        </State>
      </div>
    </div>
  );
}

// ============================================================ BACKORDERS
type BoLine = {
  lineId: number; orderNumber: string; orderedAt: string; daysWaiting: number; status: string;
  customer: string; company: string | null; phone: string | null; sku: string; name: string; qty: number; value: number;
};
type BoGroup = { supplier: string; lines: BoLine[]; units: number; value: number };

function Backorders() {
  const { data, loading, error, reload } = useReport<{ suppliers: BoGroup[]; totals: any }>(() => reportsApi.backorders(), []);
  const [supplier, setSupplier] = useState('all');
  const [printing, setPrinting] = useState(false);
  const groups = (data?.suppliers || []).filter((g) => supplier === 'all' || g.supplier === supplier);
  const lineCols: Col<BoLine>[] = [
    { key: 'o', label: 'Order', value: (r) => r.orderNumber },
    { key: 'd', label: 'Ordered', value: (r) => r.orderedAt, render: (r) => dateOnly(r.orderedAt) },
    {
      key: 'w', label: 'Waiting', align: 'right', value: (r) => r.daysWaiting,
      render: (r) => <span className={r.daysWaiting > 30 ? 'text-red-500 font-semibold' : r.daysWaiting > 14 ? 'text-amber-500' : ''}>{r.daysWaiting} days</span>,
    },
    { key: 'c', label: 'Customer', value: (r) => r.customer + (r.company ? ` (${r.company})` : '') },
    { key: 'p', label: 'Phone', value: (r) => r.phone || '' },
    { key: 'sku', label: 'SKU', value: (r) => r.sku },
    { key: 'n', label: 'Product', value: (r) => r.name },
    { key: 'q', label: 'Qty', align: 'right', value: (r) => r.qty },
    { key: 'v', label: 'Value', align: 'right', value: (r) => r.value, render: (r) => money(r.value) },
  ];
  const exportAll = () =>
    downloadCsv(
      'backorders-by-supplier.csv',
      ['Supplier', ...lineCols.map((c) => c.label)],
      groups.flatMap((g) => g.lines.map((l) => [g.supplier, ...lineCols.map((c) => (c.value ? c.value(l) : ''))])),
    );
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard label="Suppliers" value={int(data.totals.suppliers)} />
            <StatCard label="Lines on backorder" value={int(data.totals.lines)} />
            <StatCard label="Units" value={int(data.totals.units)} />
            <StatCard label="Value" value={money(data.totals.value)} />
            <StatCard label="Longest wait" value={`${int(data.totals.oldestDays)} days`} tone={data.totals.oldestDays > 30 ? 'bad' : undefined} />
          </div>
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Supplier</label>
              <select className="input w-64" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="all">All suppliers</option>
                {data.suppliers.map((g) => (
                  <option key={g.supplier} value={g.supplier}>{g.supplier} ({g.lines.length})</option>
                ))}
              </select>
            </div>
            <button className="btn-secondary" onClick={exportAll} disabled={!groups.length}>Export CSV</button>
            <button className="btn-secondary" onClick={() => setPrinting(true)} disabled={!groups.length}>Print</button>
            <button className="btn-secondary" onClick={reload}>Refresh</button>
          </div>
          {groups.length === 0 && <div className="card p-6 text-gray-400">Nothing on backorder.</div>}
          {groups.map((g) => (
            <DataTable
              key={g.supplier}
              title={`${g.supplier} — ${g.lines.length} lines, ${int(g.units)} units, ${money(g.value)}`}
              rows={g.lines}
              columns={lineCols}
            />
          ))}
          <Note>
            Open backorder items that haven't been marked received, oldest first. The supplier comes from the supplier price list the SKU is on,
            otherwise the product's brand; custom items with no supplier show under Unknown supplier.
          </Note>
          {printing && (
            <PrintSheet title="Backorders by supplier" onClose={() => setPrinting(false)}>
              <p className="mb-4 text-gray-600">Australian Lighting & Fans · printed {dateTime(new Date().toISOString())}</p>
              {groups.map((g) => (
                <div key={g.supplier} className="mb-5">
                  <h3 className="font-bold border-b border-gray-400 mb-1">{g.supplier} — {g.lines.length} lines, {int(g.units)} units</h3>
                  <table className="w-full text-xs">
                    <thead><tr className="text-left">
                      <th className="py-1">Order</th><th>Ordered</th><th>Customer</th><th>Phone</th><th>SKU</th><th>Product</th><th className="text-right">Qty</th>
                    </tr></thead>
                    <tbody>
                      {g.lines.map((l) => (
                        <tr key={l.lineId} className="border-t border-gray-200">
                          <td className="py-1">{l.orderNumber}</td><td>{dateOnly(l.orderedAt)}</td><td>{l.customer}</td>
                          <td>{l.phone || ''}</td><td>{l.sku}</td><td>{l.name}</td><td className="text-right">{l.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </PrintSheet>
          )}
        </div>
      )}
    </State>
  );
}

// ============================================================ DISCOUNTS / QUOTES (existing)
const oldParams = (p: ReportRange) => ({ dateFrom: `${p.from} 00:00:00`, dateTo: `${p.to} 23:59:59` });

function Discounts({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any[]>(() => reportsApi.getDiscountReport(oldParams(params)), [key]);
  return (
    <State loading={loading} error={error}>
      <DataTable
        title="Discounts by role and type"
        csvName={`discounts-${params.from}-to-${params.to}.csv`}
        rows={data || []}
        columns={[
          { key: 'role', label: 'Role', value: (r: any) => String(r.userRole || '').replace(/_/g, ' ') },
          { key: 'type', label: 'Type', value: (r: any) => r.discountType },
          { key: 'n', label: 'Times used', align: 'right', value: (r: any) => Number(r.usageCount), render: (r: any) => int(Number(r.usageCount)) },
          { key: 't', label: 'Total discount', align: 'right', value: (r: any) => Number(r.totalDiscount), render: (r: any) => money(Number(r.totalDiscount)) },
          { key: 'a', label: 'Average %', align: 'right', value: (r: any) => Number(r.avgDiscountPercent), render: (r: any) => pct(Number(r.avgDiscountPercent)) },
        ]}
      />
    </State>
  );
}

function Quotes({ params }: { params: ReportRange }) {
  const key = JSON.stringify(params);
  const { data, loading, error } = useReport<any>(() => reportsApi.getQuotesReport(oldParams(params)), [key]);
  const conv = data?.conversionRate;
  const rate = conv && Number(conv.total) ? (Number(conv.converted) / Number(conv.total)) * 100 : null;
  return (
    <State loading={loading} error={error}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard label="Quotes created" value={int(Number(conv?.total || 0))} />
            <StatCard label="Converted to sales" value={int(Number(conv?.converted || 0))} />
            <StatCard label="Conversion rate" value={pct(rate)} />
          </div>
          <DataTable
            title="Quotes by status"
            csvName={`quotes-${params.from}-to-${params.to}.csv`}
            rows={data.byStatus || []}
            columns={[
              { key: 's', label: 'Status', value: (r: any) => r.status },
              { key: 'n', label: 'Quotes', align: 'right', value: (r: any) => Number(r.count), render: (r: any) => int(Number(r.count)) },
              { key: 'v', label: 'Value', align: 'right', value: (r: any) => Number(r.totalValue), render: (r: any) => money(Number(r.totalValue)) },
            ]}
          />
        </div>
      )}
    </State>
  );
}
