import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config();

// Import of the old Excel invoices (Australian Lighting, 2019 -> Apr 2026)
// as completed POS orders. Feed = import_documents.ndjson produced by
// the parse/report scripts (one line per invoice: customer, lines,
// totals, payment history, source file).
//
//   npm run import:legacy-invoices -- /root/legacy-invoices/import_documents.ndjson --dry-run
//   npm run import:legacy-invoices -- /root/legacy-invoices/import_documents.ndjson
//   options: --limit N   --files-dir /opt/pos-aus-light/legacy-invoices
//
// Decisions (Sally, 29 Sep / 1 Oct 2026):
//   * invoices from 2019 onward; quotes are NOT imported (POS quotes need
//     catalogue products) — the 45 recent ones are listed in the report
//   * invoices with no number import under their file name (LF-...)
//   * part-paid and "payment not typed in" invoices import as COMPLETE /
//     PAID; what the sheet said is kept in the internal note
//   * customers matched by phone, then email; otherwise created when the
//     invoice has a phone or email; name-only invoices keep the name on
//     the order and get no customer record
//   * every order carries the original file name so the exact invoice
//     the customer received can be opened from the order screen
// Re-runnable: orders whose number already exists are skipped, so an
// interrupted run can simply be started again.

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'pos_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'pos_aus_light',
  synchronize: false,
  logging: false,
  charset: 'utf8mb4',
});

type Line = {
  qty: number | null;
  description: string | null;
  unit_price: number | null;
  taken: number | null;
  backorder: number | null;
  total: number | null;
};
type Doc = {
  order_number: string;
  legacy_number: string | null;
  unnumbered: boolean;
  doc_type: string;
  date: string;
  updated_on: string | null;
  consultant: string | null;
  customer: {
    first_name: string | null; last_name: string | null; company: string | null;
    street: string | null; suburb: string | null; state: string | null; postcode: string | null;
    phone: string | null; email: string | null;
  };
  lines: Line[];
  total: number;
  paid: number | null;
  to_pay: number | null;
  pay_status: string;
  payments: { date: string; amount: number }[];
  file: string;
  saves: number;
  warnings: string[];
};

const args = process.argv.slice(2);
const feed = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : 0;
const filesDirArg = args.indexOf('--files-dir');
const filesDir =
  filesDirArg >= 0 ? args[filesDirArg + 1] : process.env.LEGACY_INVOICES_DIR || '/opt/pos-aus-light/legacy-invoices';

if (!feed) {
  console.error('usage: import-legacy-invoices <import_documents.ndjson> [--dry-run] [--limit N] [--files-dir DIR]');
  process.exit(1);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sqlDate = (iso: string | null | undefined, fallback?: string): string => {
  const s = (iso || fallback || '').replace('T', ' ').slice(0, 19);
  return s.length >= 10 ? (s.length === 10 ? s + ' 12:00:00' : s) : '2019-01-01 12:00:00';
};
const normPhone = (v: unknown): string | null => {
  let d = String(v ?? '').replace(/\D+/g, '');
  if (d.startsWith('61') && d.length === 11) d = '0' + d.slice(2);
  if (d.length === 9 && '234578'.includes(d[0])) d = '0' + d;
  return d.length === 10 ? d : null;
};

// Turn the sheet's lines into order_item rows + note lines.
function buildItems(doc: Doc): { rows: Array<{ sku: string; name: string; qty: number; unit: number; total: number }>; notes: string[] } {
  const rows: Array<{ sku: string; name: string; qty: number; unit: number; total: number }> = [];
  const notes: string[] = [];
  for (const l of doc.lines || []) {
    const desc = (l.description || '').trim();
    const total = l.total != null ? Number(l.total) : null;
    const qtyRaw = l.qty != null ? Number(l.qty) : null;
    if (total == null && (qtyRaw == null || qtyRaw === 0)) {
      if (desc) notes.push(desc);
      continue;
    }
    if (qtyRaw === 0 && total === 0) {
      if (desc) notes.push(desc);
      continue;
    }
    let qty = qtyRaw ?? 1;
    let unit = l.unit_price != null ? Number(l.unit_price) : null;
    let name = desc || 'Item';
    const lineTotal = total != null ? total : (unit != null ? r2(unit * qty) : 0);
    if (qty <= 0 || qty !== Math.floor(qty) || lineTotal < 0) {
      // fractional (metres), zero, or negative (credit / "less deposit")
      // lines: keep the money exact on a single unit and say what it was
      if (qty !== 1 && qty !== 0) name = `${name} [${qty} × ${unit != null ? '$' + unit.toFixed(2) : 'unit'}]`;
      qty = 1;
      unit = lineTotal;
    } else if (unit == null) {
      unit = r2(lineTotal / qty);
    }
    // backorder / taken split as on the sheet
    if ((l.backorder || 0) > 0) name = `${name} [${l.backorder} on backorder at the time]`;
    rows.push({ sku: '', name: name.slice(0, 255), qty, unit: r2(unit), total: r2(lineTotal) });
  }
  const sum = r2(rows.reduce((s, x) => s + x.total, 0));
  const diff = r2(Number(doc.total) - sum);
  if (Math.abs(diff) >= 0.01) {
    rows.push({ sku: '', name: 'Adjustment to match printed invoice total', qty: 1, unit: diff, total: diff });
  }
  return { rows, notes };
}

async function main() {
  const t0 = Date.now();
  await ds.initialize();
  console.log(`connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}${dryRun ? '  [DRY RUN — nothing will be written]' : ''}`);

  // ---- lookups: existing orders, customers, system user
  // Lower-cased: the order_number unique index is case-insensitive.
  const existing = new Set<string>(
    (await ds.query(`SELECT order_number FROM orders WHERE source = 'legacy' OR order_number LIKE 'L-%' OR order_number LIKE 'LF-%'`)).map((r: any) => String(r.order_number).toLowerCase()),
  );
  const byPhone = new Map<string, number>();
  const byEmail = new Map<string, number>();
  for (const c of await ds.query(`SELECT id, phone, mobile, email FROM customers`)) {
    for (const p of [c.phone, c.mobile]) {
      const n = normPhone(p);
      if (n && !byPhone.has(n)) byPhone.set(n, c.id);
    }
    const e = String(c.email || '').trim().toLowerCase();
    if (e && e !== 'null' && e.includes('@') && !byEmail.has(e)) byEmail.set(e, c.id);
  }
  console.log(`existing legacy orders: ${existing.size}; POS customers indexed: ${byPhone.size} phones, ${byEmail.size} emails`);

  let userId: number;
  const u = await ds.query(`SELECT id FROM users WHERE first_name = 'Legacy' AND last_name = 'Import' LIMIT 1`);
  if (u.length) {
    userId = u[0].id;
  } else {
    const role = await ds.query(`SELECT id FROM roles WHERE name = 'sales_staff' LIMIT 1`);
    if (!role.length) throw new Error('sales_staff role not found');
    if (dryRun) {
      userId = -1;
      console.log('would create system user "Legacy Import"');
    } else {
      let pin = '';
      for (let i = 0; i < 20 && !pin; i++) {
        const cand = String(Math.floor(100000 + Math.random() * 900000));
        const clash = await ds.query(`SELECT id FROM users WHERE pin_code = ?`, [cand]);
        if (!clash.length) pin = cand;
      }
      const res = await ds.query(
        `INSERT INTO users (role_id, email, password_hash, pin_code, first_name, last_name, is_active) VALUES (?, NULL, NULL, ?, 'Legacy', 'Import', 0)`,
        [role[0].id, pin],
      );
      userId = res.insertId;
      console.log(`created system user "Legacy Import" #${userId} (inactive, cannot log in)`);
    }
  }

  // ---- stream the feed
  const stats: Record<string, number> = {
    read: 0, skipped_existing: 0, imported: 0, items: 0, payments: 0,
    cust_phone: 0, cust_email: 0, cust_created: 0, cust_name_only: 0, cust_none: 0,
    files_missing: 0, adjustments: 0,
  };
  const newCustomerKeys = new Map<string, number>(); // phone/email -> id (within run)
  let pending: Doc[] = [];
  const CHUNK = 100;

  const rl = readline.createInterface({ input: fs.createReadStream(feed as string, { encoding: 'utf-8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.read++;
    if (limit && stats.read > limit) break;
    const doc: Doc = JSON.parse(line);
    if (existing.has(doc.order_number.toLowerCase())) { stats.skipped_existing++; continue; }
    existing.add(doc.order_number.toLowerCase());
    pending.push(doc);
    if (pending.length >= CHUNK) { await flush(pending); pending = []; }
  }
  if (pending.length) await flush(pending);

  async function resolveCustomer(doc: Doc, qr: any): Promise<{ id: number | null; how: string }> {
    const c = doc.customer;
    const phone = normPhone(c.phone);
    const email = (c.email || '').trim().toLowerCase();
    if (phone && byPhone.has(phone)) return { id: byPhone.get(phone)!, how: 'phone' };
    if (email && byEmail.has(email)) return { id: byEmail.get(email)!, how: 'email' };
    const key = phone || (email || null);
    if (!key) {
      return { id: null, how: c.first_name || c.last_name || c.company ? 'name_only' : 'none' };
    }
    if (newCustomerKeys.has(key)) return { id: newCustomerKeys.get(key)!, how: 'created' };
    const first = (c.first_name || c.company || 'Customer').slice(0, 100);
    const last = (c.last_name || '').slice(0, 100) || null;
    if (dryRun) {
      newCustomerKeys.set(key, -1);
      return { id: null, how: 'created' };
    }
    const res = await qr.query(
      `INSERT INTO customers (first_name, last_name, email, phone, company, billing_street, billing_city, billing_state, billing_postcode, is_trade, is_guest, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', ?)`,
      [first, last, email || null, phone, c.company ? c.company.slice(0, 200) : null,
       c.street ? c.street.slice(0, 500) : null, c.suburb ? c.suburb.slice(0, 100) : null,
       c.state ? c.state.slice(0, 100) : null, c.postcode ? c.postcode.slice(0, 20) : null,
       sqlDate(doc.date)],
    );
    const id = res.insertId as number;
    // Rollback aid: every customer this run creates, one id per line.
    fs.appendFileSync(path.join(filesDir, 'legacy-import-created-customers.log'), `${id}
`);
    newCustomerKeys.set(key, id);
    if (phone) byPhone.set(phone, id);
    if (email) byEmail.set(email, id);
    return { id, how: 'created' };
  }

  async function flush(docs: Doc[]) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    if (!dryRun) await qr.startTransaction();
    try {
      for (const doc of docs) {
        const { rows, notes } = buildItems(doc);
        if (rows.some((x) => x.name === 'Adjustment to match printed invoice total')) stats.adjustments++;
        const cust = await resolveCustomer(doc, qr);
        stats[cust.how === 'phone' ? 'cust_phone' : cust.how === 'email' ? 'cust_email' : cust.how === 'created' ? 'cust_created' : cust.how === 'name_only' ? 'cust_name_only' : 'cust_none']++;
        if (!fs.existsSync(path.join(filesDir, doc.file))) stats.files_missing++;

        const total = r2(Number(doc.total));
        const tax = r2(total / 11);
        const c = doc.customer;
        const nameSnap = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || null;
        const created = sqlDate(doc.date);
        const updated = sqlDate(doc.updated_on, doc.date);
        const sheetPay =
          doc.pay_status === 'paid in full' ? 'paid in full'
          : doc.pay_status === 'part paid' ? `part paid on the sheet (paid $${Number(doc.paid || 0).toFixed(2)}, to pay $${Number(doc.to_pay || 0).toFixed(2)}) — imported as complete per Sally, 1 Oct 2026`
          : 'no payment typed on the sheet — imported as complete per Sally, 1 Oct 2026';
        const internal = [
          `Imported from legacy invoice ${doc.file}${doc.legacy_number ? ` (invoice ${doc.legacy_number})` : ' (no number on the invoice; file name used)'} on ${new Date().toISOString().slice(0, 10)}.`,
          doc.consultant ? `Consultant: ${doc.consultant}.` : null,
          doc.saves > 1 ? `Saved ${doc.saves} times; this is the last version.` : null,
          `Payment: ${sheetPay}.`,
          notes.length ? `Notes on the invoice: ${notes.join(' | ')}` : null,
          doc.warnings.length ? `Import warnings: ${doc.warnings.join('; ')}` : null,
        ].filter(Boolean).join(' ');

        if (dryRun) {
          stats.imported++; stats.items += rows.length; stats.payments += Math.max(1, doc.payments.length);
          continue;
        }

        const ins = await qr.query(
          `INSERT INTO orders (order_number, customer_id, user_id, subtotal, discount_amount, tax_amount, grand_total, tax_rate,
             status, payment_status, sync_status, notes, internal_notes, customer_name_snapshot, source, order_type,
             delivery_type, delivery_fee, legacy_file, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, 0.1, 'complete', 'paid', 'synced', NULL, ?, ?, 'legacy', 'standard', 'pickup', 0, ?, ?, ?)`,
          [doc.order_number, cust.id, userId, total, tax, total, internal, nameSnap ? nameSnap.slice(0, 255) : null, doc.file.slice(0, 255), created, updated],
        );
        const orderId = ins.insertId as number;

        if (rows.length) {
          const vals: any[] = [];
          const ph = rows.map((x) => {
            vals.push(orderId, null, x.sku, x.name, x.qty, x.unit, 0, 0, r2(x.total / 11), x.total, created);
            return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
          }).join(',');
          await qr.query(
            `INSERT INTO order_items (order_id, product_id, sku, name, quantity, unit_price, discount_percent, discount_amount, tax_amount, row_total, created_at) VALUES ${ph}`,
            vals,
          );
          stats.items += rows.length;
        }

        // payments: the deposits the sheet recorded over time, then whatever
        // is left dated at the last save — the order is complete either way
        let pays = (doc.payments || []).filter((p) => p.amount > 0.005).map((p) => ({ date: sqlDate(p.date, doc.date), amount: r2(p.amount) }));
        const paidSoFar = r2(pays.reduce((s, p) => s + p.amount, 0));
        if (paidSoFar < total - 0.005) pays.push({ date: updated, amount: r2(total - paidSoFar) });
        else if (paidSoFar > total + 0.005 && pays.length) pays[pays.length - 1].amount = r2(pays[pays.length - 1].amount - (paidSoFar - total));
        pays = pays.filter((p) => p.amount > 0.005);
        if (!pays.length) pays = [{ date: created, amount: total }];
        if (total > 0) {
          const pv: any[] = [];
          const pph = pays.map((p, i) => {
            pv.push(orderId, userId, 'other', 'Legacy invoice', p.amount, 'completed',
              i === 0 && doc.payments.length > 1 ? 'Deposit as recorded on the original invoice' : 'As recorded on the original invoice', p.date);
            return '(?, ?, ?, ?, ?, ?, ?, ?)';
          }).join(',');
          await qr.query(
            `INSERT INTO payments (order_id, user_id, method, reference, amount, status, notes, created_at) VALUES ${pph}`,
            pv,
          );
          stats.payments += pays.length;
        }

        await qr.query(
          `INSERT INTO order_events (order_id, user_id, type, description, created_at) VALUES (?, ?, 'legacy_import', ?, ?)`,
          [orderId, userId, `Imported from the old invoice system (${doc.file}).`, updated],
        );
        stats.imported++;
      }
      if (!dryRun) await qr.commitTransaction();
    } catch (err) {
      if (!dryRun) await qr.rollbackTransaction();
      console.error(`chunk failed at order ${docs[0]?.order_number}..${docs[docs.length - 1]?.order_number}:`, err);
      throw err;
    } finally {
      await qr.release();
    }
    if (stats.imported % 2000 < CHUNK) {
      console.log(`  ${stats.imported} imported, ${stats.skipped_existing} already there, ${stats.cust_created} customers created  (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  }

  console.log('\nDONE' + (dryRun ? ' (dry run)' : ''));
  console.log(JSON.stringify({ ...stats, newCustomersInRun: newCustomerKeys.size, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
