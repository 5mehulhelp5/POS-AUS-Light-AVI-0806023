import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Quote, QuoteStatus, QuoteBuyerType } from './entities/quote.entity';
import { QuoteItem } from './entities/quote-item.entity';
import { Product } from '../products/entities/product.entity';
import { Customer } from '../customers/entities/customer.entity';
import { TradeDiscountsService } from '../products/trade-discounts.service';

export interface CreateQuoteItemDto {
  // Catalogue product. Custom lines send isCustom (or a productId <= 0,
  // the client's temporary id) with their own sku / name / unitPrice.
  productId: number | null;
  quantity: number;
  discountPercent?: number;
  unitPrice?: number;
  isCustom?: boolean;
  sku?: string;
  name?: string;
  // The user typed this line's price or discount (Sally, 8 Oct 2026:
  // "user is wanting to change to $69.00 but total price is $72.76 ...
  // and user can not clear the discount %"). The line is saved exactly
  // as entered — no trade auto-discount on top.
  priceOverridden?: boolean;
}

export interface CreateQuoteDto {
  customerId?: number;
  items: CreateQuoteItemDto[];
  notes?: string;
  expiryDays?: number;
  buyerType?: QuoteBuyerType;
}

export type UpdateQuoteDto = CreateQuoteDto;

export interface ConvertQuoteResult {
  outOfStock?: Array<{ sku: string; name: string; requested: number; available: number }>;
  expiredPastGrace?: { expiredAt: Date; graceDays: number };
}

@Injectable()
export class QuotesService {
  // GST is extracted from gross prices (gross / 11) — see createQuote /
  // updateQuote. The legacy +10%-on-top calculation was removed because
  // it caused payment mismatches when converting a quote to an order.

  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,
    @InjectRepository(QuoteItem)
    private readonly quoteItemRepository: Repository<QuoteItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly tradeDiscounts: TradeDiscountsService,
  ) {}

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // Prices every line of a quote. Shared by create() and update().
  private async buildItems(
    items: CreateQuoteItemDto[],
    isTrade: boolean,
  ): Promise<{
    quoteItems: Partial<QuoteItem>[];
    subtotal: number;
    totalDiscount: number;
  }> {
    let subtotal = 0;
    let totalDiscount = 0;
    const quoteItems: Partial<QuoteItem>[] = [];

    for (const item of items) {
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
      const manualDiscount = Math.min(100, Math.max(0, Number(item.discountPercent) || 0));
      const isCustom = !!item.isCustom || !item.productId || Number(item.productId) <= 0;

      let productId: number | null = null;
      let sku: string;
      let name: string;
      let unitPrice: number;
      let discountPercent: number;
      let priceOverridden = !!item.priceOverridden;

      if (isCustom) {
        // Custom item (Sally, 8 Oct 2026: "Product with ID -17914...
        // not found"). Everything comes from the line; no catalogue
        // lookup, no trade rule — same as a custom item at the till.
        const price = Number(item.unitPrice);
        if (!Number.isFinite(price) || price < 0) {
          throw new BadRequestException(
            `Custom item "${item.name || item.sku || ''}" needs a valid price`,
          );
        }
        if (!(item.name || '').trim() && !(item.sku || '').trim()) {
          throw new BadRequestException('Custom item needs a name');
        }
        sku = (item.sku || '').trim().slice(0, 100) || 'CUSTOM';
        name = ((item.name || '').trim() || sku).slice(0, 255);
        unitPrice = price;
        discountPercent = manualDiscount;
        priceOverridden = true;
      } else {
        const product = await this.productRepository.findOne({
          where: { id: Number(item.productId) },
          relations: isTrade ? ['categories'] : [],
        });
        if (!product) {
          throw new NotFoundException(`Product with ID ${item.productId} not found`);
        }
        productId = product.id;
        sku = product.sku;
        name = product.name;

        // Resolve the trade rate first — the base-price choice depends on
        // what it actually works out to. Mirrors orders.service.ts::create.
        const auto =
          isTrade && !priceOverridden
            ? await this.tradeDiscounts.getAutoDiscount(product)
            : { percent: 0, label: null, baseOnSpecialPrice: false };
        const autoTrade = auto.percent;

        // Trade rules flagged baseOnSpecialPrice (all of them since 8 Oct
        // 2026) apply their % to the sale-aware price; a trade price set
        // on the product is a % off the fixed retail. If the trade rate
        // lands ABOVE what a walk-in would pay on a deep sale, the
        // customer price wins and the trade % is dropped.
        const retailNet = product.isOnSale
          ? Number(product.specialPrice)
          : Number(product.price);
        const tradeBase = auto.baseOnSpecialPrice
          ? retailNet
          : Number(product.price);
        const tradeNet = tradeBase * (1 - autoTrade / 100);
        const tradeWins = !isTrade || tradeNet <= retailNet;
        const defaultPrice = isTrade
          ? tradeWins
            ? tradeBase
            : retailNet
          : retailNet;
        // The quote form sends the price it showed; honour it.
        unitPrice =
          item.unitPrice != null && Number(item.unitPrice) >= 0
            ? Number(item.unitPrice)
            : defaultPrice;
        // Trade auto-discount is the floor; the user's % only wins when
        // higher — unless they typed the price / discount themselves, in
        // which case the line is exactly what they entered.
        discountPercent = priceOverridden
          ? manualDiscount
          : Math.max(manualDiscount, tradeWins ? autoTrade : 0);
      }

      const lineSubtotal = unitPrice * quantity;
      const discountAmount = this.round(lineSubtotal * (discountPercent / 100));
      const lineAfterDiscount = lineSubtotal - discountAmount;
      // AU prices are GST-inclusive. Extract the GST component
      // (gross / 11) instead of adding 10% on top — this matches the
      // convention used by the cart slice and the orders / discount
      // service so quote conversion doesn't trigger a total mismatch.
      const lineTax = this.round(lineAfterDiscount / 11);
      const rowTotal = this.round(lineAfterDiscount); // already gross

      subtotal += lineSubtotal;
      totalDiscount += discountAmount;

      quoteItems.push({
        productId,
        sku,
        name,
        quantity,
        unitPrice,
        discountPercent,
        discountAmount,
        taxAmount: lineTax,
        rowTotal,
        priceOverridden,
      });
    }
    return { quoteItems, subtotal, totalDiscount };
  }

  private async generateQuoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `QT-${year}-`;

    const lastQuote = await this.quoteRepository
      .createQueryBuilder('quote')
      .where('quote.quoteNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('quote.quoteNumber', 'DESC')
      .getOne();

    let nextNumber = 1;
    if (lastQuote) {
      const lastNum = parseInt(lastQuote.quoteNumber.replace(prefix, ''), 10);
      nextNumber = lastNum + 1;
    }

    return `${prefix}${String(nextNumber).padStart(6, '0')}`;
  }

  async create(dto: CreateQuoteDto, userId: number): Promise<Quote> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Quote must have at least one item');
    }

    // Validate customer if provided
    if (dto.customerId) {
      const customer = await this.customerRepository.findOne({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
    }

    // Determine buyer type up front — trade buyers get the auto
    // category-based discounts (Magento rules 88/89/92).
    const buyerType = dto.buyerType || QuoteBuyerType.CUSTOMER;
    const isTrade = buyerType === QuoteBuyerType.TRADE;

    const { quoteItems, subtotal, totalDiscount } = await this.buildItems(
      dto.items,
      isTrade,
    );

    const afterDiscount = subtotal - totalDiscount;
    const taxAmount = this.round(afterDiscount / 11);
    const grandTotal = this.round(afterDiscount); // gross — GST already included
    // Default expiry: 90 days for trade, 30 days for customer
    const defaultExpiry = buyerType === QuoteBuyerType.TRADE ? 90 : 30;
    const expiryDays = dto.expiryDays || defaultExpiry;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const quoteNumber = await this.generateQuoteNumber();

    const quote = this.quoteRepository.create({
      quoteNumber,
      customerId: dto.customerId || null,
      userId,
      subtotal: this.round(subtotal),
      discountAmount: this.round(totalDiscount),
      taxAmount,
      grandTotal,
      status: QuoteStatus.OPEN,
      expiresAt,
      buyerType,
      notes: dto.notes || null,
      items: quoteItems as QuoteItem[],
    });

    const savedQuote = await this.quoteRepository.save(quote);

    // Return with relations loaded
    return this.quoteRepository.findOne({
      where: { id: savedQuote.id },
      relations: ['customer', 'user', 'items'],
    }) as Promise<Quote>;
  }

  async update(id: number, dto: UpdateQuoteDto, userId: number): Promise<Quote> {
    const existing = await this.quoteRepository.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!existing) throw new NotFoundException('Quote not found');
    if (existing.status !== QuoteStatus.OPEN) {
      throw new BadRequestException(
        `Cannot edit a quote with status "${existing.status}"`,
      );
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Quote must have at least one item');
    }

    if (dto.customerId) {
      const customer = await this.customerRepository.findOne({
        where: { id: dto.customerId },
      });
      if (!customer) throw new NotFoundException('Customer not found');
    }

    // Same trade-discount gating as create() — a quote that's edited
    // into a trade quote should pick up the auto rules too.
    const updatedBuyerType =
      dto.buyerType || existing.buyerType || QuoteBuyerType.CUSTOMER;
    const isTrade = updatedBuyerType === QuoteBuyerType.TRADE;

    // Price the new lines BEFORE dropping the old ones, so a bad line
    // can't leave the quote empty.
    const { quoteItems, subtotal, totalDiscount } = await this.buildItems(
      dto.items,
      isTrade,
    );
    for (const qi of quoteItems) qi.quoteId = id;
    await this.quoteItemRepository.delete({ quoteId: id });

    const afterDiscount = subtotal - totalDiscount;
    const taxAmount = this.round(afterDiscount / 11);
    const grandTotal = this.round(afterDiscount); // gross — GST already included

    const buyerType = updatedBuyerType;
    // If expiry explicitly passed, use it; if buyerType changed, reset from the buyerType default; else keep existing expiry
    let expiresAt = existing.expiresAt;
    if (dto.expiryDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + dto.expiryDays);
    } else if (buyerType !== existing.buyerType) {
      const defaultExpiry = buyerType === QuoteBuyerType.TRADE ? 90 : 30;
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + defaultExpiry);
    }

    existing.customerId = dto.customerId || null;
    existing.userId = userId; // whoever last edited
    existing.subtotal = this.round(subtotal);
    existing.discountAmount = this.round(totalDiscount);
    existing.taxAmount = taxAmount;
    existing.grandTotal = grandTotal;
    existing.buyerType = buyerType;
    existing.expiresAt = expiresAt;
    existing.notes = dto.notes || null;

    await this.quoteRepository.save(existing);
    await this.quoteItemRepository.save(quoteItems as QuoteItem[]);

    return this.quoteRepository.findOne({
      where: { id },
      relations: ['customer', 'user', 'items'],
    }) as Promise<Quote>;
  }

  async cancel(id: number, userId: number): Promise<Quote> {
    const quote = await this.quoteRepository.findOne({ where: { id } });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.status === QuoteStatus.CONVERTED) {
      throw new BadRequestException('Cannot cancel a converted quote');
    }
    if (quote.status === QuoteStatus.CANCELLED) {
      throw new BadRequestException('Quote is already cancelled');
    }
    quote.status = QuoteStatus.CANCELLED;
    quote.cancelledAt = new Date();
    quote.cancelledBy = userId;
    await this.quoteRepository.save(quote);
    return this.quoteRepository.findOne({
      where: { id },
      relations: ['customer', 'user', 'items'],
    }) as Promise<Quote>;
  }

  /**
   * Validates a quote can be converted: not already converted/cancelled,
   * within grace period if expired, and all items have enough stock.
   * Returns any blocking reasons (out of stock items, expired past grace).
   * If `allowBackorder` is true, skips the stock check.
   */
  async validateConvert(
    id: number,
    allowBackorder = false,
  ): Promise<{ quote: Quote; blockers: ConvertQuoteResult; expiredWithinGrace: boolean }> {
    const quote = await this.quoteRepository.findOne({
      where: { id },
      relations: ['items', 'customer'],
    });
    if (!quote) throw new NotFoundException('Quote not found');

    if (quote.status === QuoteStatus.CONVERTED) {
      throw new BadRequestException('Quote has already been converted');
    }
    if (quote.status === QuoteStatus.CANCELLED) {
      throw new BadRequestException('Cannot convert a cancelled quote');
    }

    const blockers: ConvertQuoteResult = {};
    let expiredWithinGrace = false;

    // Grace period check
    const now = new Date();
    const graceDays =
      quote.buyerType === QuoteBuyerType.TRADE ? 30 : 15;
    const graceEnd = new Date(quote.expiresAt);
    graceEnd.setDate(graceEnd.getDate() + graceDays);

    if (now > quote.expiresAt) {
      if (now > graceEnd) {
        blockers.expiredPastGrace = { expiredAt: quote.expiresAt, graceDays };
      } else {
        expiredWithinGrace = true;
      }
    }

    // Stock check
    if (!allowBackorder) {
      const outOfStock: NonNullable<ConvertQuoteResult['outOfStock']> = [];
      for (const item of quote.items) {
        if (!item.productId) continue;
        const product = await this.productRepository.findOne({
          where: { id: item.productId },
        });
        if (!product) continue;
        const available = Number(product.stockQty);
        if (available < item.quantity) {
          outOfStock.push({
            sku: item.sku,
            name: item.name,
            requested: item.quantity,
            available,
          });
        }
      }
      if (outOfStock.length > 0) blockers.outOfStock = outOfStock;
    }

    return { quote, blockers, expiredWithinGrace };
  }

  /**
   * Returns the effective unit price for conversion:
   * - if current product price is LOWER than quoted → use current (customer-friendly)
   * - otherwise → use quoted price (frozen, honour the quote)
   */
  async computeConversionPrices(quote: Quote): Promise<
    Array<{
      productId: number | null;
      sku: string;
      name: string;
      quantity: number;
      quotedUnitPrice: number;
      effectiveUnitPrice: number;
      discountPercent: number;
      priceDropped: boolean;
    }>
  > {
    const rows = [];
    for (const item of quote.items) {
      const quotedUnitPrice = Number(item.unitPrice);
      let effectiveUnitPrice = quotedUnitPrice;
      let priceDropped = false;

      if (item.productId) {
        const product = await this.productRepository.findOne({
          where: { id: item.productId },
        });
        if (product) {
          const currentPrice = product.isOnSale
            ? Number(product.specialPrice)
            : Number(product.price);
          if (currentPrice < quotedUnitPrice) {
            effectiveUnitPrice = currentPrice;
            priceDropped = true;
          }
        }
      }

      rows.push({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        quotedUnitPrice,
        effectiveUnitPrice,
        discountPercent: Number(item.discountPercent),
        priceDropped,
      });
    }
    return rows;
  }

  async markConverted(id: number, orderId: number): Promise<void> {
    await this.quoteRepository.update(id, {
      status: QuoteStatus.CONVERTED,
      convertedOrderId: orderId,
    });
  }

  async findAll(options?: {
    status?: QuoteStatus;
    customerId?: number;
    page?: number;
    limit?: number;
  }): Promise<{ quotes: Quote[]; total: number }> {
    const { status, customerId } = options || {};
    const page = Number(options?.page) || 1;
    const limit = Number(options?.limit) || 20;

    const query = this.quoteRepository
      .createQueryBuilder('quote')
      .leftJoinAndSelect('quote.customer', 'customer')
      .leftJoinAndSelect('quote.user', 'user')
      .leftJoinAndSelect('quote.items', 'items');

    if (status) {
      query.andWhere('quote.status = :status', { status });
    }

    if (customerId) {
      query.andWhere('quote.customerId = :customerId', { customerId });
    }

    const [quotes, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('quote.createdAt', 'DESC')
      .getManyAndCount();

    return { quotes, total };
  }

  async findById(id: number): Promise<Quote | null> {
    return this.quoteRepository.findOne({
      where: { id },
      relations: ['customer', 'user', 'items'],
    });
  }
}
