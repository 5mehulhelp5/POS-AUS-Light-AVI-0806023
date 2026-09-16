import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Customer, SyncStatus } from './entities';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Refund } from '../orders/entities/refund.entity';
import { Quote, QuoteStatus } from '../quotes/entities/quote.entity';

export interface CustomerStats {
  totalSpent: number;
  orderCount: number;
  activeQuoteCount: number;
  previousQuoteCount: number;
  lastPurchaseDate: Date | null;
  // Active layby orders (LAYBY_ACTIVE or LAYBY_EXPIRED) and the total
  // balance the customer still owes across them. Surfaces lay-by
  // commitments on the customer profile so staff don't lose track.
  activeLaybyCount: number;
  laybyBalanceOwing: number;
}

/**
 * Strip everything that isn't a digit. Used for de-dupe matching and
 * for storage so "0434 310 130", "0434-310-130", and "0434310130" all
 * collide on the same customer.
 */
function normalisePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\D+/g, '');
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Normalise + validate a customer payload before save. Mutates the
   * passed object so create/update use the cleaned values.
   * Rules:
   *   - phone (or mobile) must be exactly 10 digits when supplied
   *   - lastName is optional
   *   - phone is stored as digits only (so "0434 310 130" -> "0434310130")
   */
  private validateAndNormalise(data: Partial<Customer>): void {
    if (data.phone !== undefined && data.phone !== null) {
      const digits = normalisePhone(data.phone);
      if (digits && digits.length !== 10) {
        throw new BadRequestException(
          `Phone number must be exactly 10 digits (got ${digits.length}: "${data.phone}")`,
        );
      }
      data.phone = digits || null;
    }
    if (data.mobile !== undefined && data.mobile !== null) {
      const digits = normalisePhone(data.mobile);
      if (digits && digits.length !== 10) {
        throw new BadRequestException(
          `Mobile number must be exactly 10 digits (got ${digits.length}: "${data.mobile}")`,
        );
      }
      data.mobile = digits || null;
    }
    if (data.lastName !== undefined) {
      // empty/whitespace -> null so the optional column stays clean
      const trimmed = data.lastName?.trim() || '';
      data.lastName = trimmed || null;
    }
  }

  async findAll(options?: {
    search?: string;
    page?: number | string;
    limit?: number | string;
  }): Promise<{ customers: Customer[]; total: number }> {
    const search = options?.search;
    // Query params arrive as strings from the controller; coerce defensively.
    const page = Number(options?.page) > 0 ? Number(options?.page) : 1;
    const limit = Number(options?.limit) > 0 ? Number(options?.limit) : 20;

    const query = this.customerRepository.createQueryBuilder('customer');

    if (search) {
      query.where(
        '(customer.firstName LIKE :search OR customer.lastName LIKE :search OR customer.email LIKE :search OR customer.phone LIKE :search OR customer.company LIKE :search OR CONCAT(customer.firstName, \' \', customer.lastName) LIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [customers, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('customer.lastName', 'ASC')
      .getManyAndCount();

    return { customers, total };
  }

  async findById(id: number): Promise<Customer | null> {
    return this.customerRepository.findOne({ where: { id } });
  }

  // The POS payment screen posts the address as street / city / state /
  // postcode; the columns are billing_*. TypeORM silently dropped the
  // unknown keys, so lay-by customers auto-created at the till had no
  // address saved. Fold the short names onto the billing columns.
  private mapAddressAliases(data: Record<string, unknown>): void {
    const pairs: Array<[string, string]> = [
      ['street', 'billingStreet'],
      ['city', 'billingCity'],
      ['state', 'billingState'],
      ['postcode', 'billingPostcode'],
    ];
    for (const [alias, column] of pairs) {
      if (data[alias] !== undefined) {
        if (data[column] === undefined) data[column] = data[alias];
        delete data[alias];
      }
    }
  }

  async create(data: Partial<Customer>): Promise<Customer> {
    this.mapAddressAliases(data as Record<string, unknown>);
    this.validateAndNormalise(data);
    const customer = this.customerRepository.create({
      ...data,
      syncStatus: SyncStatus.PENDING,
    });
    return this.customerRepository.save(customer);
  }

  async update(id: number, data: Partial<Customer>): Promise<Customer> {
    const customer = await this.findById(id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    this.mapAddressAliases(data as Record<string, unknown>);
    this.validateAndNormalise(data);
    await this.customerRepository.update(id, data);
    return this.findById(id) as Promise<Customer>;
  }

  /**
   * Find groups of customer rows that share a phone number (after
   * normalisation) and collapse each group into a single canonical
   * record. The oldest row by id wins. All foreign-key references
   * (orders, quotes, inquiries, store credit + transactions) are
   * repointed to the canonical row before the duplicates are deleted.
   *
   * Returns a summary so the caller can show the cashier what changed.
   */
  async mergeDuplicatesByPhone(): Promise<{
    groupsFound: number;
    customersMerged: number;
    creditTransferred: number;
  }> {
    // eslint-disable-next-line no-console
    console.log('[customers.merge] starting merge-duplicates-by-phone');

    // First pass: rewrite every phone/mobile in the table to digits only,
    // so historical rows ("0434 310 130", "0434-310-130", null spaces…)
    // collapse onto the same canonical string. This makes the GROUP BY
    // below catch dupes that only differ by formatting.
    //
    // MySQL syntax: REGEXP_REPLACE replaces all matches by default; the
    // 4th-arg "flags" form is PostgreSQL-only. The pattern matches one
    // or more non-digits.
    try {
      await this.dataSource.query(
        `UPDATE customers SET phone = REGEXP_REPLACE(phone, '[^0-9]+', '') WHERE phone IS NOT NULL`,
      );
      await this.dataSource.query(
        `UPDATE customers SET mobile = REGEXP_REPLACE(mobile, '[^0-9]+', '') WHERE mobile IS NOT NULL`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[customers.merge] phone normalisation failed:', err);
      throw err;
    }

    // Find all phone -> [ids...] groupings where there are duplicates.
    // MySQL: GROUP_CONCAT returns a CSV string; we split it in JS.
    const rawRows: Array<{ phone: string; ids: string }> = await this.dataSource
      .query(
        `SELECT phone, GROUP_CONCAT(id ORDER BY id ASC) AS ids
         FROM customers
         WHERE phone IS NOT NULL AND phone <> ''
         GROUP BY phone
         HAVING COUNT(*) > 1`,
      );
    const rows: Array<{ phone: string; ids: number[] }> = rawRows.map((r) => ({
      phone: r.phone,
      ids: String(r.ids).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
    }));

    // eslint-disable-next-line no-console
    console.log(
      `[customers.merge] found ${rows.length} duplicate group(s):`,
      rows.map((r) => `${r.phone}=[${r.ids.join(',')}]`).join(' '),
    );

    let customersMerged = 0;
    let creditTransferred = 0;

    for (const group of rows) {
      const ids: number[] = group.ids;
      if (!ids || ids.length < 2) continue;
      const canonicalId = ids[0];
      const dupeIds = ids.slice(1);
      // eslint-disable-next-line no-console
      console.log(
        `[customers.merge] merging dupes ${dupeIds.join(',')} into ${canonicalId} (phone=${group.phone})`,
      );

      try {
      await this.dataSource.transaction(async (manager) => {
        // Repoint all FK tables. We hit raw SQL here because some of
        // the entities live in other modules and importing them just
        // for an UPDATE adds noise.
        // MySQL syntax — `?` placeholders, expanded IN list.
        const inPlaceholders = dupeIds.map(() => '?').join(',');
        await manager.query(
          `UPDATE orders SET customer_id = ? WHERE customer_id IN (${inPlaceholders})`,
          [canonicalId, ...dupeIds],
        );
        await manager.query(
          `UPDATE quotes SET customer_id = ? WHERE customer_id IN (${inPlaceholders})`,
          [canonicalId, ...dupeIds],
        );
        await manager.query(
          `UPDATE inquiries SET customer_id = ? WHERE customer_id IN (${inPlaceholders})`,
          [canonicalId, ...dupeIds],
        );
        await manager.query(
          `UPDATE store_credit_transactions SET customer_id = ? WHERE customer_id IN (${inPlaceholders})`,
          [canonicalId, ...dupeIds],
        );

        // Store credit is unique per customer — sum the dupes' balances
        // into the canonical row, then delete the dupe rows.
        const dupeCredits: Array<{ balance: string }> = await manager.query(
          `SELECT balance FROM store_credits WHERE customer_id IN (${inPlaceholders})`,
          [...dupeIds],
        );
        const transferAmount = dupeCredits.reduce(
          (sum, r) => sum + Number(r.balance || 0),
          0,
        );
        if (transferAmount > 0) {
          // Make sure the canonical has a row (no-op upsert), then add
          // the transfer. ON DUPLICATE KEY UPDATE balance = balance is
          // a MySQL idiom for "insert if missing, do nothing if there".
          await manager.query(
            `INSERT INTO store_credits (customer_id, balance)
             VALUES (?, 0)
             ON DUPLICATE KEY UPDATE balance = balance`,
            [canonicalId],
          );
          await manager.query(
            `UPDATE store_credits SET balance = balance + ? WHERE customer_id = ?`,
            [transferAmount, canonicalId],
          );
          creditTransferred += transferAmount;
        }
        await manager.query(
          `DELETE FROM store_credits WHERE customer_id IN (${inPlaceholders})`,
          [...dupeIds],
        );

        // Backfill any missing fields on the canonical from a dupe so
        // we don't lose contact info just because the oldest record
        // was sparse.
        const dupes = await manager.find(Customer, {
          where: dupeIds.map((id) => ({ id })),
        });
        const canonical = await manager.findOne(Customer, {
          where: { id: canonicalId },
        });
        if (canonical) {
          const fields: (keyof Customer)[] = [
            'email',
            'mobile',
            'company',
            'taxNumber',
            'lastName',
            'billingStreet',
            'billingCity',
            'billingState',
            'billingPostcode',
            'shippingStreet',
            'shippingCity',
            'shippingState',
            'shippingPostcode',
          ];
          let touched = false;
          for (const f of fields) {
            if (!canonical[f]) {
              const fromDupe = dupes.find((d) => !!d[f]);
              if (fromDupe) {
                (canonical as any)[f] = fromDupe[f];
                touched = true;
              }
            }
          }
          // If any dupe was marked trade, the canonical inherits it.
          if (!canonical.isTrade && dupes.some((d) => d.isTrade)) {
            canonical.isTrade = true;
            touched = true;
          }
          if (touched) await manager.save(canonical);
        }

        // Finally, drop the duplicate customer rows.
        await manager.delete(Customer, dupeIds);
      });

      customersMerged += dupeIds.length;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[customers.merge] failed to merge group phone=${group.phone} ids=${ids.join(',')}:`,
          err,
        );
        throw err;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[customers.merge] done: ${rows.length} group(s), ${customersMerged} dupe(s) merged, $${creditTransferred.toFixed(2)} store credit consolidated`,
    );

    return {
      groupsFound: rows.length,
      customersMerged,
      creditTransferred: Math.round(creditTransferred * 100) / 100,
    };
  }

  async getStats(customerId: number): Promise<CustomerStats> {
    // Sum grand totals of all non-cancelled orders for this customer
    const orderSum = await this.orderRepository
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.grandTotal), 0)', 'total')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(o.createdAt)', 'lastDate')
      .where('o.customerId = :id', { id: customerId })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .getRawOne();

    const orderTotal = Number(orderSum?.total || 0);
    const orderCount = Number(orderSum?.count || 0);
    const lastPurchaseDate = orderSum?.lastDate || null;

    // Subtract refunds against those orders
    const refundSum = await this.refundRepository
      .createQueryBuilder('r')
      .innerJoin('r.order', 'o')
      .select('COALESCE(SUM(r.refundAmount), 0)', 'total')
      .where('o.customerId = :id', { id: customerId })
      .getRawOne();

    const refundTotal = Number(refundSum?.total || 0);
    const totalSpent = Math.max(0, Math.round((orderTotal - refundTotal) * 100) / 100);

    // Quote counts — "active" = open AND not yet past expiry; "previous" = everything else
    const now = new Date();
    const activeQuoteCount = await this.quoteRepository
      .createQueryBuilder('q')
      .where('q.customerId = :id', { id: customerId })
      .andWhere('q.status = :open', { open: QuoteStatus.OPEN })
      .andWhere('q.expiresAt >= :now', { now })
      .getCount();

    const previousQuoteCount = await this.quoteRepository
      .createQueryBuilder('q')
      .where('q.customerId = :id', { id: customerId })
      .andWhere(
        '(q.status != :open OR q.expiresAt < :now)',
        { open: QuoteStatus.OPEN, now },
      )
      .getCount();

    // Layby commitments: count active + expired laybys for this
    // customer and sum what they still owe across them.
    // MySQL syntax — `?` placeholders, no PG-style casts.
    const laybyRows: Array<{ id: number; grand_total: string; paid: string }> =
      await this.dataSource.query(
        `SELECT o.id,
                o.grand_total AS grand_total,
                COALESCE((
                  SELECT SUM(p.amount)
                  FROM payments p
                  WHERE p.order_id = o.id
                    AND p.status = 'completed'
                ), 0) AS paid
         FROM orders o
         WHERE o.customer_id = ?
           AND o.status IN (?, ?)`,
        [customerId, OrderStatus.LAYBY_ACTIVE, OrderStatus.LAYBY_EXPIRED],
      );

    const activeLaybyCount = laybyRows.length;
    const laybyBalanceOwing = Math.round(
      laybyRows.reduce(
        (sum, r) =>
          sum + Math.max(0, Number(r.grand_total) - Number(r.paid)),
        0,
      ) * 100,
    ) / 100;

    return {
      totalSpent,
      orderCount,
      activeQuoteCount,
      previousQuoteCount,
      lastPurchaseDate: lastPurchaseDate ? new Date(lastPurchaseDate) : null,
      activeLaybyCount,
      laybyBalanceOwing,
    };
  }
}
