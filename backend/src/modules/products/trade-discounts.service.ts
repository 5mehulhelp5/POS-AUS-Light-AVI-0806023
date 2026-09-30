import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { SettingsService } from '../settings/settings.service';
import {
  TradeRule,
  DEFAULT_TRADE_RULES,
  normaliseTradeRules,
} from './trade-rules.defaults';

// Trade auto-discounts mirror the Magento cart price rules Sally
// maintains (rule IDs 88, 89, 92) so the POS can price a trade cart
// without a Magento round-trip. The rules are data, loaded from the
// `trade_discount_rules` setting and editable under Settings -> Trade
// Pricing; trade-rules.defaults.ts holds the seed/fallback set.
//
// Resolution rule per line:
//   - Pick the SINGLE highest matching auto discount (rules don't stack
//     with each other — matches Magento's stop_rules_processing default
//     for these rules)
//   - The cashier's manual line discount overrides the auto one ONLY if
//     it's higher; otherwise the auto value wins. So the trade customer
//     always gets at least their entitled discount.
const RULES_CACHE_TTL_MS = 60_000;

// Minimum margin over cost, as a percent. Sally, 29 Sep 2026: lowered
// from 30 to 20 "to cater for low dollar value items such as
// downlights". Stored in the `min_margin_percent` setting so the next
// change is a Settings edit, not a deploy.
export const DEFAULT_MIN_MARGIN_PERCENT = 20;
export const MIN_MARGIN_SETTING_KEY = 'min_margin_percent';

export function normaliseMarginPercent(raw: unknown): number {
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n)) {
    return DEFAULT_MIN_MARGIN_PERCENT;
  }
  return Math.min(500, Math.max(0, Math.round(n * 100) / 100));
}

@Injectable()
export class TradeDiscountsService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly settingsService: SettingsService,
  ) {}

  // Rules are read on every priced line, so cache them briefly rather
  // than hitting settings per product. An admin edit takes effect
  // within a minute without a restart.
  private rulesCache: { rules: TradeRule[]; loadedAt: number } | null = null;

  async getRules(): Promise<TradeRule[]> {
    const now = Date.now();
    if (this.rulesCache && now - this.rulesCache.loadedAt < RULES_CACHE_TTL_MS) {
      return this.rulesCache.rules;
    }
    let rules: TradeRule[];
    try {
      const stored = await this.settingsService.getValue<any>(
        'trade_discount_rules',
        null,
      );
      rules = normaliseTradeRules(stored);
    } catch {
      // Never let a settings hiccup strip a trade customer's discount.
      rules = DEFAULT_TRADE_RULES;
    }
    this.rulesCache = { rules, loadedAt: now };
    return rules;
  }

  private marginCache: { percent: number; loadedAt: number } | null = null;

  async getMinMarginPercent(): Promise<number> {
    const now = Date.now();
    if (this.marginCache && now - this.marginCache.loadedAt < RULES_CACHE_TTL_MS) {
      return this.marginCache.percent;
    }
    let percent = DEFAULT_MIN_MARGIN_PERCENT;
    try {
      const stored = await this.settingsService.getValue<unknown>(
        MIN_MARGIN_SETTING_KEY,
        null,
      );
      percent = normaliseMarginPercent(stored);
    } catch {
      // keep the default — never fail a sale over a settings read
    }
    this.marginCache = { percent, loadedAt: now };
    return percent;
  }

  async getMinMarginMultiplier(): Promise<number> {
    return 1 + (await this.getMinMarginPercent()) / 100;
  }

  invalidateMarginCache(): void {
    this.marginCache = null;
  }

  // Called after an admin saves new rules so the next priced line picks
  // them up immediately instead of waiting out the TTL.
  invalidateRulesCache(): void {
    this.rulesCache = null;
    // Rules may target different category names now.
    this.nameSubtreeCache.clear();
  }

  // Cache: smart-home root id → set of itself + all descendant ids.
  // Categories rarely change so we just memoise the first lookup; a
  // fresh sync that adds children needs a backend restart to pick them
  // up (acceptable trade-off for this code path).
  private subtreeCache = new Map<number, Set<number>>();

  private async getSubtreeIds(rootId: number): Promise<Set<number>> {
    const cached = this.subtreeCache.get(rootId);
    if (cached) return cached;
    const all = await this.categoryRepository.find({
      select: ['id', 'parentId'],
    });
    const childrenByParent = new Map<number, number[]>();
    for (const c of all) {
      if (c.parentId == null) continue;
      if (!childrenByParent.has(c.parentId)) {
        childrenByParent.set(c.parentId, []);
      }
      childrenByParent.get(c.parentId)!.push(c.id);
    }
    const result = new Set<number>([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const kids = childrenByParent.get(id) || [];
      for (const k of kids) {
        if (!result.has(k)) {
          result.add(k);
          queue.push(k);
        }
      }
    }
    this.subtreeCache.set(rootId, result);
    return result;
  }

  // Returns the percent (0-100) of the best-matching trade rule for
  // this product, plus a label so the caller can show it to the cashier
  // / log it. Returns 0 / null when no rule matches.
  // Cache: category NAME phrase (lowercased) → union of subtree ids for
  // every category matching it. Same lifetime as subtreeCache.
  private nameSubtreeCache = new Map<string, Set<number>>();

  // CONTAINS match, not exact: the POS tree has no category literally
  // named "Ceiling Fans" — the fan categories are "DC Ceiling Fans",
  // "Outdoor Ceiling Fans", "Ceiling Fans with Lights", etc. under a
  // parent called "Fans". A word-bounded contains match catches all of
  // them (but not, say, "Pedestal Fans").
  private async getSubtreeIdsByName(categoryName: string): Promise<Set<number>> {
    const key = categoryName.trim().toLowerCase();
    const cached = this.nameSubtreeCache.get(key);
    if (cached) return cached;
    const all = await this.categoryRepository.find({ select: ['id', 'name'] });
    const phrase = new RegExp(
      `(^|[^a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
      'i',
    );
    const roots = all.filter((c) => phrase.test((c.name || '').trim()));
    const result = new Set<number>();
    for (const root of roots) {
      for (const id of await this.getSubtreeIds(root.id)) {
        result.add(id);
      }
    }
    this.nameSubtreeCache.set(key, result);
    return result;
  }

  // A product counts as clearance when any of its categories is named
  // like one ("Warehouse Clearance", "Clearance", "Sale").
  private isClearanceProduct(product: Product): boolean {
    return (product.categories || []).some((c) => {
      const n = (c.name || '').trim().toLowerCase();
      return /clearance/.test(n) || n === 'sale';
    });
  }

  async getAutoDiscount(product: Product): Promise<{
    percent: number;
    label: string | null;
    // The % applies to the sale-aware effective price instead of the
    // fixed retail RRP (ceiling-fans rule).
    baseOnSpecialPrice: boolean;
    // Set when the percent was derived from a per-product trade price.
    fixedPrice?: number | null;
  }> {
    const NONE = { percent: 0, label: null, baseOnSpecialPrice: false };

    // Per-product trade price wins over every rule. It is expressed as
    // its exact % off the fixed retail price so the whole pricing
    // pipeline (cart, quotes, orders, customer-price-wins) treats it
    // like any other trade rate — no second code path to keep in step.
    // A trade price at or above retail is meaningless; fall through to
    // the rules in that case (e.g. retail was cut below it in Magento).
    const fixed = product.tradePrice != null ? Number(product.tradePrice) : null;
    const rrp = Number(product.price);
    if (fixed != null && fixed > 0 && rrp > 0 && fixed < rrp) {
      return {
        percent: (1 - fixed / rrp) * 100,
        label: 'Trade price (set for this product)',
        baseOnSpecialPrice: false,
        fixedPrice: fixed,
      };
    }
    const rules = await this.getRules();
    const productCategoryIds = new Set<number>(
      (product.categories || []).map((c) => c.id),
    );
    const name = (product.name || '').trim().toLowerCase();

    // First enabled match WINS and terminates — mirrors Magento's
    // stop_rules_processing. Rule order is part of the configuration.
    for (const rule of rules) {
      if (!rule.enabled) continue;

      // Brand exclusion applies to every matchType. Whole-word prefix
      // so "Eglo" doesn't also exclude something like "Eglobe".
      const prefix = (rule.excludeNamePrefix || '').toLowerCase();
      const excludedByPrefix =
        !!prefix && new RegExp(`^${prefix}\\b`, 'i').test(name);

      let matches = false;
      switch (rule.matchType) {
        case 'category': {
          if (rule.categoryId == null) break;
          // Match the category itself OR anything beneath it, so naming
          // a parent catches its children without listing them all.
          const subtree = await this.getSubtreeIds(rule.categoryId);
          matches = [...productCategoryIds].some((id) => subtree.has(id));
          break;
        }
        case 'category_name': {
          if (!rule.categoryName) break;
          const subtree = await this.getSubtreeIdsByName(rule.categoryName);
          matches = [...productCategoryIds].some((id) => subtree.has(id));
          break;
        }
        case 'all_except_prefix':
          matches = true; // prefix handled below for all types
          break;
        case 'all':
          matches = true;
          break;
      }

      if (!matches || excludedByPrefix) {
        // Category rules with an excluded brand fall through to later
        // rules ONLY when the category itself didn't match; a brand
        // exclusion on a matching category rule means "no discount for
        // this brand here", but broader rules may still apply — except
        // they carry the same brand exclusions in practice, so simply
        // continue.
        continue;
      }

      // SALE / CLEARANCE carve-out: the item matched this rule but is
      // marked down already — no trade discount, and no falling through
      // to a broader (bigger) rule either.
      if (rule.excludeClearance && this.isClearanceProduct(product)) {
        return NONE;
      }

      return this.applyMarginFloor(product, {
        percent: rule.percent,
        label: rule.label,
        baseOnSpecialPrice: rule.baseOnSpecialPrice === true,
      });
    }
    return NONE;
  }

  // The trade rate never takes a product under the minimum margin
  // (Sally, 1 Oct 2026: Stargem $66 retail, 20% trade = $52.80, cost
  // $46.60 + 20% = $55.92, "we are making a loss ... if the Margin Rule
  // price is higher than the Trade price, display the Margin Rule as the
  // Trade Price"). So: trade price = max(rule price, cost + margin%).
  // If even the retail price is under the floor, trade gets no discount
  // at all. Only applies when the POS knows the cost. A trade price set
  // on the product itself is admin-approved and skips this (see above).
  private async applyMarginFloor(
    product: Product,
    auto: { percent: number; label: string | null; baseOnSpecialPrice: boolean },
  ): Promise<{ percent: number; label: string | null; baseOnSpecialPrice: boolean; fixedPrice?: number | null }> {
    const cost = product.cost != null ? Number(product.cost) : null;
    if (!cost || cost <= 0 || auto.percent <= 0) return auto;
    const marginPct = await this.getMinMarginPercent();
    const floor = cost * (1 + marginPct / 100);
    const base = auto.baseOnSpecialPrice
      ? Number(product.effectivePrice)
      : Number(product.price);
    if (!(base > 0)) return auto;
    const tradeNet = base * (1 - auto.percent / 100);
    if (tradeNet >= floor - 0.005) return auto;
    if (floor >= base - 0.005) {
      return {
        percent: 0,
        label: `${auto.label || 'Trade'} — no trade discount, retail is already at the minimum margin`,
        baseOnSpecialPrice: auto.baseOnSpecialPrice,
      };
    }
    const flooredPrice = Math.round(floor * 100) / 100;
    return {
      percent: (1 - flooredPrice / base) * 100,
      label: `${auto.label || 'Trade'} — limited to cost + ${marginPct}%`,
      baseOnSpecialPrice: auto.baseOnSpecialPrice,
    };
  }
}
