import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DayClose } from './entities/day-close.entity';

// ---------------------------------------------------------------------
// Reporting (Sally, Oct 2026). All money is GST-inclusive as stored
// unless a field says "ex". Dates are Melbourne store days: the DB holds
// UTC and MySQL's named time zones are loaded, so ranges and buckets are
// converted with CONVERT_TZ (DST handled).
//
// A "sale" is any order except cancelled / expired lay-bys / unpaid
// website orders, counted on the day it was placed. Refunds are counted
// on the day they were given, so a later refund reduces that day's net.
// ---------------------------------------------------------------------

const TZ = 'Australia/Melbourne';
const COUNTED = `o.status NOT IN ('cancelled','layby_expired','pending')`;

export type Channel = 'store' | 'pos' | 'web' | 'all';
export type GroupBy = 'day' | 'week' | 'month' | 'year';

export interface RangeQuery {
  from: string;
  to: string;
  channel?: string;
  groupBy?: string;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number): number => Math.round(v * 100) / 100;
const ex = (v: number): number => r2(v / 1.1);
const toSqlUtc = (d: Date): string => d.toISOString().replace('T', ' ').replace('Z', '');

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DayClose)
    private readonly dayCloseRepo: Repository<DayClose>,
  ) {}

  // ------------------------------------------------------------ helpers
  private channelSql(ch?: string): string {
    switch (ch) {
      case 'pos':
        return `o.source = 'pos'`;
      case 'web':
        return `o.source = 'magento'`;
      case 'all':
        return '1=1';
      default:
        // In-store: POS sales plus the imported old invoices.
        return `o.source IN ('pos','legacy')`;
    }
  }

  private checkRange(q: RangeQuery): { from: string; to: string } {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!q.from || !q.to || !re.test(q.from) || !re.test(q.to)) {
      throw new BadRequestException('from and to are required as YYYY-MM-DD');
    }
    if (q.from > q.to) throw new BadRequestException('from must be on or before to');
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86400000;
    if (days > 366 * 12) throw new BadRequestException('Range is limited to 12 years');
    return { from: q.from, to: q.to };
  }

  // SQL fragment: column falls on [from, to] Melbourne days (inclusive).
  private inRange(col: string): string {
    return `${col} >= CONVERT_TZ(?, '${TZ}', '+00:00') AND ${col} < CONVERT_TZ(DATE_ADD(?, INTERVAL 1 DAY), '${TZ}', '+00:00')`;
  }
  private rangeParams(from: string, to: string): string[] {
    return [`${from} 00:00:00`, `${to} 00:00:00`];
  }

  private local(col: string): string {
    return `CONVERT_TZ(${col}, '+00:00', '${TZ}')`;
  }

  private bucket(col: string, g: GroupBy): string {
    const l = this.local(col);
    switch (g) {
      case 'week':
        return `DATE_FORMAT(DATE_SUB(DATE(${l}), INTERVAL WEEKDAY(${l}) DAY), '%Y-%m-%d')`;
      case 'month':
        return `DATE_FORMAT(${l}, '%Y-%m')`;
      case 'year':
        return `DATE_FORMAT(${l}, '%Y')`;
      default:
        return `DATE_FORMAT(${l}, '%Y-%m-%d')`;
    }
  }

  private pickGroupBy(from: string, to: string, requested?: string): GroupBy {
    if (requested === 'day' || requested === 'week' || requested === 'month' || requested === 'year') {
      return requested;
    }
    const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    if (days <= 62) return 'day';
    if (days <= 750) return 'month';
    return 'year';
  }

  // Same length immediately before [from, to].
  private previousRange(from: string, to: string): { from: string; to: string } {
    const f = Date.parse(from + 'T00:00:00Z');
    const t = Date.parse(to + 'T00:00:00Z');
    const len = Math.round((t - f) / 86400000) + 1;
    const pTo = new Date(f - 86400000);
    const pFrom = new Date(f - len * 86400000);
    return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) };
  }

  // ------------------------------------------------------------ summary
  private async totals(from: string, to: string, channel?: string, tradeOnly = false) {
    const ch = this.channelSql(channel);
    const trade = tradeOnly ? ' AND o.is_trade = 1' : '';
    const [o] = await this.dataSource.query(
      `SELECT COUNT(*) transactions, COALESCE(SUM(o.grand_total),0) gross,
              COALESCE(SUM(o.discount_amount),0) discounts, COALESCE(SUM(o.tax_amount),0) tax,
              COALESCE(SUM(o.delivery_fee),0) delivery,
              COALESCE(SUM(o.is_trade),0) tradeTransactions,
              COALESCE(SUM(CASE WHEN o.is_trade = 1 THEN o.grand_total ELSE 0 END),0) tradeSales
         FROM orders o
        WHERE ${COUNTED} AND ${ch}${trade} AND ${this.inRange('o.created_at')}`,
      this.rangeParams(from, to),
    );
    const [r] = await this.dataSource.query(
      `SELECT COUNT(*) refunds, COALESCE(SUM(r.refund_amount),0) refundTotal
         FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE ${ch}${trade} AND ${this.inRange('r.created_at')}`,
      this.rangeParams(from, to),
    );
    const gross = n(o.gross);
    const refundTotal = n(r.refundTotal);
    const transactions = n(o.transactions);
    return {
      transactions,
      gross: r2(gross),
      discounts: r2(n(o.discounts)),
      tax: r2(n(o.tax)),
      delivery: r2(n(o.delivery)),
      refunds: n(r.refunds),
      refundTotal: r2(refundTotal),
      net: r2(gross - refundTotal),
      netExGst: ex(gross - refundTotal),
      averageSale: transactions ? r2(gross / transactions) : 0,
      tradeTransactions: n(o.tradeTransactions),
      tradeSales: r2(n(o.tradeSales)),
    };
  }

  async salesSummary(q: RangeQuery & { tradeOnly?: boolean }) {
    const { from, to } = this.checkRange(q);
    const g = this.pickGroupBy(from, to, q.groupBy);
    const ch = this.channelSql(q.channel);
    const trade = q.tradeOnly ? ' AND o.is_trade = 1' : '';
    const prev = this.previousRange(from, to);
    const [current, previous] = await Promise.all([
      this.totals(from, to, q.channel, !!q.tradeOnly),
      this.totals(prev.from, prev.to, q.channel, !!q.tradeOnly),
    ]);
    const sales = await this.dataSource.query(
      `SELECT ${this.bucket('o.created_at', g)} period, COUNT(*) transactions, SUM(o.grand_total) gross
         FROM orders o
        WHERE ${COUNTED} AND ${ch}${trade} AND ${this.inRange('o.created_at')}
        GROUP BY period ORDER BY period`,
      this.rangeParams(from, to),
    );
    const refunds = await this.dataSource.query(
      `SELECT ${this.bucket('r.created_at', g)} period, SUM(r.refund_amount) refundTotal
         FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE ${ch}${trade} AND ${this.inRange('r.created_at')}
        GROUP BY period`,
      this.rangeParams(from, to),
    );
    const byPeriod = new Map<string, { period: string; transactions: number; gross: number; refunds: number; net: number }>();
    for (const s of sales) {
      byPeriod.set(s.period, { period: s.period, transactions: n(s.transactions), gross: r2(n(s.gross)), refunds: 0, net: r2(n(s.gross)) });
    }
    for (const rf of refunds) {
      const row = byPeriod.get(rf.period) || { period: rf.period, transactions: 0, gross: 0, refunds: 0, net: 0 };
      row.refunds = r2(n(rf.refundTotal));
      row.net = r2(row.gross - row.refunds);
      byPeriod.set(rf.period, row);
    }
    return {
      range: { from, to, groupBy: g },
      previousRange: prev,
      current,
      previous,
      series: [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)),
    };
  }

  // ------------------------------------------------------------ end of day
  // POS till only. Window = last close -> now, or start of today if the
  // till has never been closed.
  private async eodWindow(): Promise<{ start: Date; end: Date; lastClose: DayClose | null }> {
    const lastClose = await this.dayCloseRepo.findOne({ where: {}, order: { closedAt: 'DESC' } });
    const end = new Date();
    if (lastClose) return { start: new Date(lastClose.closedAt), end, lastClose };
    const [row] = await this.dataSource.query(
      `SELECT CONVERT_TZ(CONCAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${TZ}')), ' 00:00:00'), '${TZ}', '+00:00') s`,
    );
    return { start: new Date(row.s), end, lastClose: null };
  }

  private async eodTotals(start: Date, end: Date) {
    const p = [toSqlUtc(start), toSqlUtc(end)];
    const win = (col: string) => `${col} >= ? AND ${col} < ?`;
    const [o] = await this.dataSource.query(
      `SELECT COUNT(*) transactions, COALESCE(SUM(o.grand_total),0) gross, COALESCE(SUM(o.discount_amount),0) discounts,
              COALESCE(SUM(o.tax_amount),0) tax, COALESCE(SUM(o.delivery_fee),0) delivery
         FROM orders o WHERE ${COUNTED} AND o.source = 'pos' AND ${win('o.created_at')}`,
      p,
    );
    const byCustomerType = await this.dataSource.query(
      `SELECT CASE WHEN o.is_trade = 1 THEN 'Trade' ELSE 'Customer' END type, COUNT(*) transactions, SUM(o.grand_total) total
         FROM orders o WHERE ${COUNTED} AND o.source = 'pos' AND ${win('o.created_at')}
        GROUP BY type ORDER BY type`,
      p,
    );
    const bySaleType = await this.dataSource.query(
      `SELECT CASE WHEN o.order_type = 'layby' THEN 'Lay-by'
                   WHEN EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.is_backorder = 1) THEN 'Backorder'
                   ELSE 'Paid in full' END type,
              COUNT(*) transactions, SUM(o.grand_total) total
         FROM orders o WHERE ${COUNTED} AND o.source = 'pos' AND ${win('o.created_at')}
        GROUP BY type ORDER BY type`,
      p,
    );
    const payments = await this.dataSource.query(
      `SELECT pm.method, COUNT(*) count, SUM(pm.amount) amount
         FROM payments pm JOIN orders o ON o.id = pm.order_id
        WHERE pm.status = 'completed' AND o.source = 'pos' AND ${win('pm.created_at')}
        GROUP BY pm.method ORDER BY amount DESC`,
      p,
    );
    const [rf] = await this.dataSource.query(
      `SELECT COUNT(*) count, COALESCE(SUM(r.refund_amount),0) amount,
              COALESCE(SUM(CASE WHEN r.reason_text LIKE '%[CASH REFUND]%' THEN r.refund_amount ELSE 0 END),0) cash
         FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.source = 'pos' AND ${win('r.created_at')}`,
      p,
    );
    const pay = payments.map((x: any) => ({ method: x.method, count: n(x.count), amount: r2(n(x.amount)) }));
    const paymentsTotal = r2(pay.reduce((s: number, x: any) => s + x.amount, 0));
    const cashIn = pay.filter((x: any) => x.method === 'cash').reduce((s: number, x: any) => s + x.amount, 0);
    const refundAmount = r2(n(rf.amount));
    const cashRefunds = r2(n(rf.cash));
    return {
      transactions: n(o.transactions),
      gross: r2(n(o.gross)),
      discounts: r2(n(o.discounts)),
      tax: r2(n(o.tax)),
      delivery: r2(n(o.delivery)),
      byCustomerType: byCustomerType.map((x: any) => ({ type: x.type, transactions: n(x.transactions), total: r2(n(x.total)) })),
      bySaleType: bySaleType.map((x: any) => ({ type: x.type, transactions: n(x.transactions), total: r2(n(x.total)) })),
      payments: pay,
      paymentsTotal,
      refunds: { count: n(rf.count), amount: refundAmount, cash: cashRefunds, storeCredit: r2(refundAmount - cashRefunds) },
      netTakings: r2(paymentsTotal - cashRefunds),
      cashExpected: r2(cashIn - cashRefunds),
    };
  }

  async endOfDay() {
    const { start, end, lastClose } = await this.eodWindow();
    return {
      window: { start: start.toISOString(), end: end.toISOString() },
      lastClose: lastClose
        ? { id: lastClose.id, closedAt: new Date(lastClose.closedAt).toISOString(), closedByName: lastClose.closedByName }
        : null,
      totals: await this.eodTotals(start, end),
    };
  }

  async closeDay(user: { id?: number; firstName?: string; lastName?: string } | undefined, body: { cashCounted?: unknown; notes?: unknown }) {
    const { start, end } = await this.eodWindow();
    const totals = await this.eodTotals(start, end);
    let cashCounted: number | null = null;
    if (body?.cashCounted !== undefined && body?.cashCounted !== null && body?.cashCounted !== '') {
      const c = Number(body.cashCounted);
      if (!Number.isFinite(c) || c < 0) throw new BadRequestException('Cash counted must be 0 or more');
      cashCounted = r2(c);
    }
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || null;
    const row = await this.dayCloseRepo.save(
      this.dayCloseRepo.create({
        openedAt: start,
        closedAt: end,
        closedBy: user?.id ?? null,
        closedByName: name,
        totals: totals as unknown as Record<string, unknown>,
        cashCounted,
        notes,
      }),
    );
    return this.formatClose(row);
  }

  private formatClose(c: DayClose) {
    const totals = c.totals as any;
    const cashCounted = c.cashCounted != null ? Number(c.cashCounted) : null;
    return {
      id: c.id,
      openedAt: new Date(c.openedAt).toISOString(),
      closedAt: new Date(c.closedAt).toISOString(),
      closedByName: c.closedByName,
      cashCounted,
      cashDifference: cashCounted != null ? r2(cashCounted - n(totals?.cashExpected)) : null,
      notes: c.notes,
      totals,
    };
  }

  async dayCloseHistory(limit = 60) {
    const rows = await this.dayCloseRepo.find({ order: { closedAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 366) });
    return rows.map((c) => this.formatClose(c));
  }

  async dayClose(id: number) {
    const c = await this.dayCloseRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Day close not found');
    return this.formatClose(c);
  }

  // ------------------------------------------------------------ profit & loss
  async profitLoss(q: RangeQuery) {
    const { from, to } = this.checkRange(q);
    const g = this.pickGroupBy(from, to, q.groupBy);
    const ch = this.channelSql(q.channel);
    const rp = this.rangeParams(from, to);
    const items = await this.dataSource.query(
      `SELECT ${this.bucket('o.created_at', g)} period,
              SUM(oi.row_total) revenue,
              SUM(CASE WHEN oi.cost_price > 0 THEN oi.row_total ELSE 0 END) revenueCosted,
              SUM(CASE WHEN oi.cost_price > 0 THEN oi.cost_price * oi.quantity ELSE 0 END) cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${COUNTED} AND ${ch} AND ${this.inRange('o.created_at')}
        GROUP BY period`,
      rp,
    );
    const orders = await this.dataSource.query(
      `SELECT ${this.bucket('o.created_at', g)} period, SUM(o.grand_total) gross, SUM(o.delivery_fee) delivery, COUNT(*) transactions
         FROM orders o WHERE ${COUNTED} AND ${ch} AND ${this.inRange('o.created_at')}
        GROUP BY period`,
      rp,
    );
    const refunds = await this.dataSource.query(
      `SELECT ${this.bucket('r.created_at', g)} period, SUM(r.refund_amount) refunds
         FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE ${ch} AND ${this.inRange('r.created_at')} GROUP BY period`,
      rp,
    );
    const refundCost = await this.dataSource.query(
      `SELECT ${this.bucket('r.created_at', g)} period,
              SUM(CASE WHEN ri.restock = 1 AND oi.cost_price > 0 THEN oi.cost_price * ri.quantity ELSE 0 END) costBack,
              SUM(CASE WHEN oi.cost_price > 0 THEN ri.amount ELSE 0 END) refundCosted
         FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
         JOIN order_items oi ON oi.id = ri.order_item_id JOIN orders o ON o.id = r.order_id
        WHERE ${ch} AND ${this.inRange('r.created_at')} GROUP BY period`,
      rp,
    );
    const periods = new Set<string>();
    const idx = (rows: any[]) => {
      const m = new Map<string, any>();
      rows.forEach((x) => { m.set(x.period, x); periods.add(x.period); });
      return m;
    };
    const I = idx(items), O = idx(orders), R = idx(refunds), C = idx(refundCost);
    const rows = [...periods].sort().map((period) => {
      const gross = n(O.get(period)?.gross);
      const delivery = n(O.get(period)?.delivery);
      const refundsInc = n(R.get(period)?.refunds);
      const revenueInc = n(I.get(period)?.revenue);
      const revenueCostedInc = n(I.get(period)?.revenueCosted) - n(C.get(period)?.refundCosted);
      const cogsInc = n(I.get(period)?.cost) - n(C.get(period)?.costBack);
      const netSales = ex(gross - refundsInc);
      const costedSales = ex(revenueCostedInc);
      const cogs = ex(cogsInc);
      const grossProfit = r2(costedSales - cogs);
      return {
        period,
        transactions: n(O.get(period)?.transactions),
        salesExGst: ex(gross),
        deliveryExGst: ex(delivery),
        refundsExGst: ex(refundsInc),
        netSalesExGst: netSales,
        costedSalesExGst: costedSales,
        cogsExGst: cogs,
        grossProfit,
        marginPct: costedSales > 0 ? r2((grossProfit / costedSales) * 100) : null,
        uncostedSalesExGst: ex(Math.max(0, revenueInc - n(I.get(period)?.revenueCosted))),
        costCoveragePct: revenueInc > 0 ? r2((n(I.get(period)?.revenueCosted) / revenueInc) * 100) : null,
      };
    });
    const sum = (k: string) => r2(rows.reduce((s, x: any) => s + n(x[k]), 0));
    const costedSales = sum('costedSalesExGst');
    const grossProfit = sum('grossProfit');
    const revenueAll = rows.reduce((s, x) => s + x.costedSalesExGst + x.uncostedSalesExGst, 0);
    return {
      range: { from, to, groupBy: g },
      rows,
      totals: {
        transactions: sum('transactions'),
        salesExGst: sum('salesExGst'),
        deliveryExGst: sum('deliveryExGst'),
        refundsExGst: sum('refundsExGst'),
        netSalesExGst: sum('netSalesExGst'),
        costedSalesExGst: costedSales,
        cogsExGst: sum('cogsExGst'),
        grossProfit,
        marginPct: costedSales > 0 ? r2((grossProfit / costedSales) * 100) : null,
        uncostedSalesExGst: sum('uncostedSalesExGst'),
        costCoveragePct: revenueAll > 0 ? r2((costedSales / revenueAll) * 100) : null,
      },
    };
  }

  // ------------------------------------------------------------ clearance
  private readonly CLEARANCE = `oi.product_id IN (
      SELECT pc.product_id FROM product_categories pc JOIN categories c ON c.id = pc.category_id
       WHERE c.name LIKE '%clearance%')`;

  async clearance(q: RangeQuery) {
    const { from, to } = this.checkRange(q);
    const g = this.pickGroupBy(from, to, q.groupBy);
    const ch = this.channelSql(q.channel);
    const rp = this.rangeParams(from, to);
    const [t] = await this.dataSource.query(
      `SELECT COALESCE(SUM(oi.quantity),0) units, COALESCE(SUM(oi.row_total),0) revenue, COUNT(DISTINCT oi.order_id) orders,
              COUNT(DISTINCT oi.product_id) products
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${COUNTED} AND ${ch} AND ${this.inRange('o.created_at')} AND ${this.CLEARANCE}`,
      rp,
    );
    const series = await this.dataSource.query(
      `SELECT ${this.bucket('o.created_at', g)} period, SUM(oi.quantity) units, SUM(oi.row_total) revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${COUNTED} AND ${ch} AND ${this.inRange('o.created_at')} AND ${this.CLEARANCE}
        GROUP BY period ORDER BY period`,
      rp,
    );
    const top = await this.dataSource.query(
      `SELECT p.id productId, p.sku, p.name, p.stock_qty stock, SUM(oi.quantity) units, SUM(oi.row_total) revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE ${COUNTED} AND ${ch} AND ${this.inRange('o.created_at')} AND ${this.CLEARANCE}
        GROUP BY p.id, p.sku, p.name, p.stock_qty ORDER BY units DESC, revenue DESC LIMIT 10`,
      rp,
    );
    return {
      range: { from, to, groupBy: g },
      totals: { units: n(t.units), revenue: r2(n(t.revenue)), orders: n(t.orders), products: n(t.products) },
      series: series.map((x: any) => ({ period: x.period, units: n(x.units), revenue: r2(n(x.revenue)) })),
      top: top.map((x: any) => ({ productId: x.productId, sku: x.sku, name: x.name, stock: n(x.stock), units: n(x.units), revenue: r2(n(x.revenue)) })),
    };
  }

  // ------------------------------------------------------------ by item
  async salesByItem(q: RangeQuery & { search?: string; tradeOnly?: boolean; limit?: number }) {
    const { from, to } = this.checkRange(q);
    const ch = this.channelSql(q.channel);
    const trade = q.tradeOnly ? ' AND o.is_trade = 1' : '';
    const params: unknown[] = this.rangeParams(from, to);
    let search = '';
    const s = (q.search || '').trim();
    if (s) {
      search = ` AND (COALESCE(p.sku, oi.sku) LIKE ? OR COALESCE(p.name, oi.name) LIKE ?)`;
      params.push(`%${s}%`, `%${s}%`);
    }
    const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 5000);
    const rows = await this.dataSource.query(
      `SELECT MAX(oi.product_id) productId, MAX(COALESCE(p.sku, oi.sku)) sku, MAX(COALESCE(p.name, oi.name)) name,
              SUM(oi.quantity) units, SUM(oi.row_total) revenue, COUNT(DISTINCT oi.order_id) orders,
              SUM(CASE WHEN oi.cost_price > 0 THEN oi.row_total ELSE 0 END) revenueCosted,
              SUM(CASE WHEN oi.cost_price > 0 THEN oi.cost_price * oi.quantity ELSE 0 END) cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE ${COUNTED} AND ${ch}${trade} AND ${this.inRange('o.created_at')}
          AND (oi.product_id IS NOT NULL OR oi.sku <> '')${search}
        GROUP BY COALESCE(CAST(oi.product_id AS CHAR), CONCAT('sku:', oi.sku))
        ORDER BY revenue DESC LIMIT ${limit}`,
      params,
    );
    const [un] = await this.dataSource.query(
      `SELECT COUNT(*) lineCount, COALESCE(SUM(oi.row_total),0) revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${COUNTED} AND ${ch}${trade} AND ${this.inRange('o.created_at')}
          AND oi.product_id IS NULL AND oi.sku = ''`,
      this.rangeParams(from, to),
    );
    return {
      range: { from, to },
      items: rows.map((x: any) => {
        const revenue = r2(n(x.revenue));
        const costedEx = ex(n(x.revenueCosted));
        const costEx = ex(n(x.cost));
        const hasCost = n(x.cost) > 0;
        return {
          productId: x.productId != null ? Number(x.productId) : null,
          sku: x.sku,
          name: x.name,
          units: n(x.units),
          orders: n(x.orders),
          revenue,
          revenueExGst: ex(revenue),
          costExGst: hasCost ? costEx : null,
          marginExGst: hasCost ? r2(costedEx - costEx) : null,
          marginPct: hasCost && costedEx > 0 ? r2(((costedEx - costEx) / costedEx) * 100) : null,
        };
      }),
      // Old-invoice lines are free text with no product code.
      unitemised: { lines: n(un.lineCount), revenue: r2(n(un.revenue)) },
    };
  }

  // ------------------------------------------------------------ customers
  async topCustomers(q: RangeQuery & { tradeOnly?: boolean; limit?: number }) {
    const { from, to } = this.checkRange(q);
    const ch = this.channelSql(q.channel);
    const trade = q.tradeOnly ? ' AND o.is_trade = 1' : '';
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
    const rows = await this.dataSource.query(
      `SELECT c.id, c.first_name firstName, c.last_name lastName, c.company, c.phone, c.email, c.is_trade isTrade,
              COUNT(o.id) orders, SUM(o.grand_total) revenue, MAX(o.created_at) lastPurchase
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE ${COUNTED} AND ${ch}${trade} AND ${this.inRange('o.created_at')}
        GROUP BY c.id, c.first_name, c.last_name, c.company, c.phone, c.email, c.is_trade
        ORDER BY revenue DESC LIMIT ${limit}`,
      this.rangeParams(from, to),
    );
    return rows.map((x: any) => ({
      id: Number(x.id),
      name: [x.firstName, x.lastName].filter(Boolean).join(' '),
      company: x.company,
      phone: x.phone,
      email: x.email,
      isTrade: !!Number(x.isTrade),
      orders: n(x.orders),
      revenue: r2(n(x.revenue)),
      averageOrder: n(x.orders) ? r2(n(x.revenue) / n(x.orders)) : 0,
      lastPurchase: x.lastPurchase ? new Date(x.lastPurchase).toISOString() : null,
    }));
  }

  async customerHistory(customerId: number) {
    const [c] = await this.dataSource.query(
      `SELECT id, first_name firstName, last_name lastName, company, phone, email, is_trade isTrade FROM customers WHERE id = ?`,
      [customerId],
    );
    if (!c) throw new NotFoundException('Customer not found');
    const orders = await this.dataSource.query(
      `SELECT o.id, o.order_number orderNumber, o.created_at createdAt, o.source, o.status, o.grand_total total,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) items,
              (SELECT COALESCE(SUM(r.refund_amount),0) FROM refunds r WHERE r.order_id = o.id) refunded
         FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 500`,
      [customerId],
    );
    const list = orders.map((x: any) => ({
      id: Number(x.id),
      orderNumber: x.orderNumber,
      createdAt: new Date(x.createdAt).toISOString(),
      source: x.source,
      status: x.status,
      items: n(x.items),
      total: r2(n(x.total)),
      refunded: r2(n(x.refunded)),
    }));
    const counted = list.filter((x: any) => !['cancelled', 'layby_expired', 'pending'].includes(x.status));
    const spend = counted.reduce((s: number, x: any) => s + x.total - x.refunded, 0);
    return {
      customer: {
        id: Number(c.id),
        name: [c.firstName, c.lastName].filter(Boolean).join(' '),
        company: c.company,
        phone: c.phone,
        email: c.email,
        isTrade: !!Number(c.isTrade),
      },
      summary: {
        orders: counted.length,
        lifetimeSpend: r2(spend),
        firstPurchase: counted.length ? counted[counted.length - 1].createdAt : null,
        lastPurchase: counted.length ? counted[0].createdAt : null,
      },
      orders: list,
    };
  }

  // ------------------------------------------------------------ staff
  async salesByStaff(q: RangeQuery) {
    const { from, to } = this.checkRange(q);
    const ch = this.channelSql(q.channel);
    const rows = await this.dataSource.query(
      `SELECT u.id, u.first_name firstName, u.last_name lastName,
              COUNT(o.id) transactions, SUM(o.grand_total) revenue, SUM(o.discount_amount) discounts,
              SUM(o.is_trade) tradeTransactions
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ${COUNTED} AND ${ch} AND ${this.inRange('o.created_at')}
        GROUP BY u.id, u.first_name, u.last_name ORDER BY revenue DESC`,
      this.rangeParams(from, to),
    );
    const refunds = await this.dataSource.query(
      `SELECT r.user_id userId, COUNT(*) count, SUM(r.refund_amount) amount
         FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE ${ch} AND ${this.inRange('r.created_at')} GROUP BY r.user_id`,
      this.rangeParams(from, to),
    );
    const rf = new Map<number, any>(refunds.map((x: any) => [Number(x.userId), x]));
    return rows.map((x: any) => {
      const legacy = x.firstName === 'Legacy' && x.lastName === 'Import';
      const t = n(x.transactions);
      return {
        userId: Number(x.id),
        name: legacy ? 'Old invoices (imported)' : [x.firstName, x.lastName].filter(Boolean).join(' '),
        transactions: t,
        revenue: r2(n(x.revenue)),
        averageSale: t ? r2(n(x.revenue) / t) : 0,
        discounts: r2(n(x.discounts)),
        tradeTransactions: n(x.tradeTransactions),
        refunds: n(rf.get(Number(x.id))?.count),
        refundAmount: r2(n(rf.get(Number(x.id))?.amount)),
      };
    });
  }

  // ------------------------------------------------------------ backorders
  // Open backorder lines grouped by supplier. Supplier = the supplier
  // price list the SKU appears on, else the product's brand category,
  // else the first word of the product name.
  async backorders() {
    const rows = await this.dataSource.query(
      `SELECT oi.id lineId, o.id orderId, o.order_number orderNumber, o.created_at createdAt, o.status,
              o.customer_name_snapshot customerSnapshot, c.first_name firstName, c.last_name lastName, c.company, c.phone,
              oi.product_id productId, oi.sku, oi.name, oi.quantity - COALESCE(rq.q, 0) qty, oi.row_total rowTotal, oi.quantity origQty,
              (SELECT sc.supplier FROM supplier_costs sc WHERE sc.sku = oi.sku ORDER BY sc.id LIMIT 1) listSupplier,
              (SELECT cat.name FROM product_categories pc JOIN categories cat ON cat.id = pc.category_id
                 JOIN categories par ON par.id = cat.parent_id AND par.name = 'Brands'
                WHERE pc.product_id = oi.product_id ORDER BY cat.id LIMIT 1) brandCategory
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN (SELECT order_item_id, SUM(quantity) q FROM refund_items GROUP BY order_item_id) rq ON rq.order_item_id = oi.id
        WHERE oi.is_backorder = 1 AND oi.backorder_fulfilled_at IS NULL
          AND o.status NOT IN ('cancelled', 'refunded', 'layby_expired')
          AND oi.quantity - COALESCE(rq.q, 0) > 0
        ORDER BY o.created_at`,
    );
    const now = Date.now();
    // One name per supplier: "Havit Lighting - Major Stockist in
    // Victoria", "Havit Lighting" and "Havit" all group as "Havit".
    const clean = (s: string | null): string => {
      let v = (s || '').replace(/\s+-\s+.*$/, '').trim();
      v = v.replace(/\s+(lighting|fans|lamps|costprice|for trade)$/i, '').trim();
      return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
    };
    const groups = new Map<string, any>();
    for (const x of rows) {
      // No guessing from the product name: custom items ("12W driver")
      // and products on no supplier list go under Unknown supplier.
      const supplier = clean(x.listSupplier) || clean(x.brandCategory) || 'Unknown supplier';
      const qty = n(x.qty);
      const unit = n(x.origQty) ? n(x.rowTotal) / n(x.origQty) : 0;
      const line = {
        lineId: Number(x.lineId),
        orderId: Number(x.orderId),
        orderNumber: x.orderNumber,
        orderedAt: new Date(x.createdAt).toISOString(),
        daysWaiting: Math.floor((now - new Date(x.createdAt).getTime()) / 86400000),
        status: x.status,
        customer: [x.firstName, x.lastName].filter(Boolean).join(' ') || x.customerSnapshot || 'Walk-in',
        company: x.company,
        phone: x.phone,
        sku: x.sku,
        name: x.name,
        qty,
        value: r2(unit * qty),
      };
      const key = supplier.toLowerCase();
      const g = groups.get(key) || { supplier, lines: [] as any[], units: 0, value: 0 };
      g.lines.push(line);
      g.units += qty;
      g.value = r2(g.value + line.value);
      groups.set(key, g);
    }
    const list = [...groups.values()].sort((a, b) =>
      a.supplier === 'Unknown supplier' ? 1 : b.supplier === 'Unknown supplier' ? -1 : a.supplier.localeCompare(b.supplier),
    );
    return {
      suppliers: list,
      totals: {
        suppliers: list.length,
        lines: rows.length,
        units: list.reduce((s, g) => s + g.units, 0),
        value: r2(list.reduce((s, g) => s + g.value, 0)),
        oldestDays: rows.length ? Math.max(...list.flatMap((g) => g.lines.map((l: any) => l.daysWaiting))) : 0,
      },
    };
  }

  // ------------------------------------------------------------ original reports
  async getSalesReport(options: {
    dateFrom: string;
    dateTo: string;
    groupBy?: 'day' | 'week' | 'month';
  }): Promise<any> {
    const { dateFrom, dateTo, groupBy = 'day' } = options;

    const summaryResult = await this.dataSource.query(
      `SELECT
        COUNT(*) as orderCount,
        SUM(grand_total) as totalSales,
        SUM(discount_amount) as totalDiscounts,
        SUM(tax_amount) as totalTax,
        AVG(grand_total) as averageOrder
      FROM orders
      WHERE created_at >= ? AND created_at <= ? AND status = 'complete'`,
      [dateFrom, dateTo],
    );

    let dateFormat = '%Y-%m-%d';
    if (groupBy === 'week') {
      dateFormat = '%Y-%u';
    } else if (groupBy === 'month') {
      dateFormat = '%Y-%m';
    }

    const salesByPeriod = await this.dataSource.query(
      `SELECT
        DATE_FORMAT(created_at, '${dateFormat}') as period,
        COUNT(*) as orderCount,
        SUM(grand_total) as totalSales
      FROM orders
      WHERE created_at >= ? AND created_at <= ? AND status = 'complete'
      GROUP BY period
      ORDER BY period`,
      [dateFrom, dateTo],
    );

    return {
      summary: summaryResult[0] || {
        orderCount: 0,
        totalSales: 0,
        totalDiscounts: 0,
        totalTax: 0,
        averageOrder: 0,
      },
      salesByPeriod,
    };
  }

  async getSalesByUser(options: { dateFrom: string; dateTo: string }): Promise<any[]> {
    const { dateFrom, dateTo } = options;
    return this.dataSource.query(
      `SELECT
        u.id as userId,
        u.first_name as firstName,
        u.last_name as lastName,
        COUNT(o.id) as orderCount,
        SUM(o.grand_total) as totalSales,
        SUM(o.discount_amount) as totalDiscounts
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND o.status = 'complete'
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY totalSales DESC`,
      [dateFrom, dateTo],
    );
  }

  async getDiscountReport(options: { dateFrom: string; dateTo: string }): Promise<any> {
    const { dateFrom, dateTo } = options;
    return this.dataSource.query(
      `SELECT
        dal.user_role as userRole,
        dal.discount_type as discountType,
        COUNT(*) as usageCount,
        SUM(dal.discount_amount) as totalDiscount,
        AVG(dal.discount_percent) as avgDiscountPercent
      FROM discount_audit_log dal
      WHERE dal.created_at >= ? AND dal.created_at <= ?
      GROUP BY dal.user_role, dal.discount_type
      ORDER BY totalDiscount DESC`,
      [dateFrom, dateTo],
    );
  }

  async getQuotesReport(options: { dateFrom: string; dateTo: string }): Promise<any> {
    const { dateFrom, dateTo } = options;
    const result = await this.dataSource.query(
      `SELECT status, COUNT(*) as count, SUM(grand_total) as totalValue
      FROM quotes WHERE created_at >= ? AND created_at <= ? GROUP BY status`,
      [dateFrom, dateTo],
    );
    const conversionRate = await this.dataSource.query(
      `SELECT COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted, COUNT(*) as total
      FROM quotes WHERE created_at >= ? AND created_at <= ?`,
      [dateFrom, dateTo],
    );
    return { byStatus: result, conversionRate: conversionRate[0] };
  }
}
