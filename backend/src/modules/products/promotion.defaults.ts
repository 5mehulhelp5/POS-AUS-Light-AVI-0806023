// Store-wide promotion applied automatically at checkout (Avi / Sally,
// 7 Oct 2026: "for all fans apply 10% at checkout, excluding the ones
// already on sale, clearance and Iconic"). Stored as JSON in the
// `fan_promotion` setting and edited under Settings -> Trade Pricing.
//
// Unlike the trade rules it applies to EVERY customer. A trade customer
// gets whichever is better, the trade rate or the promotion.
export interface Promotion {
  enabled: boolean;
  label: string;
  percent: number;
  // Exact category names (case-insensitive); each includes its whole
  // subtree. Names, not ids, so a category re-sync can't break it.
  includeCategories: string[];
  excludeCategories: string[];
  // Product name (whole word) or SKU (plain prefix) starting with any of
  // these is excluded — how the Iconic Fan Company range is identified,
  // since its brand category in Magento has no products in it.
  excludePrefixes: string[];
  // Last day of the promotion (YYYY-MM-DD, store time), or null for
  // open-ended.
  endsOn: string | null;
  // Red strip across the top of the POS while the promotion runs.
  // {percent} in the text is replaced with the discount.
  showBanner: boolean;
  bannerText: string;
}

export const PROMOTION_SETTING_KEY = 'fan_promotion';

export const DEFAULT_PROMOTION: Promotion = {
  enabled: true,
  label: 'Fan promotion',
  percent: 10,
  includeCategories: ['Fans', 'Smart Ceiling Fans', 'IKKÜ Ceiling Fans'],
  excludeCategories: ['Fan Accesories'],
  excludePrefixes: ['Iconic', 'Artemis', 'Sycamore'],
  endsOn: null,
  showBanner: true,
  bannerText:
    'FAN PROMOTION — {percent}% OFF ALL FANS AT CHECKOUT · Excludes fans already on sale, clearance and Iconic fans',
};

const list = (v: unknown, fallback: string[]): string[] => {
  if (Array.isArray(v)) {
    return v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 50);
  }
  if (typeof v === 'string') {
    return v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
  }
  return fallback;
};

export function normalisePromotion(raw: unknown): Promotion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pct = Number(r.percent);
  const ends = typeof r.endsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.endsOn.trim())
    ? r.endsOn.trim()
    : null;
  return {
    enabled: r.enabled === undefined ? DEFAULT_PROMOTION.enabled : r.enabled === true,
    label: (typeof r.label === 'string' && r.label.trim()) ? r.label.trim().slice(0, 60) : DEFAULT_PROMOTION.label,
    percent: Number.isFinite(pct) && pct > 0 && pct <= 90 ? Math.round(pct * 100) / 100 : DEFAULT_PROMOTION.percent,
    includeCategories: list(r.includeCategories, DEFAULT_PROMOTION.includeCategories),
    excludeCategories: list(r.excludeCategories, DEFAULT_PROMOTION.excludeCategories),
    excludePrefixes: list(r.excludePrefixes, DEFAULT_PROMOTION.excludePrefixes),
    endsOn: ends,
    showBanner: r.showBanner === undefined ? DEFAULT_PROMOTION.showBanner : r.showBanner === true,
    bannerText:
      typeof r.bannerText === 'string' && r.bannerText.trim()
        ? r.bannerText.trim().slice(0, 300)
        : DEFAULT_PROMOTION.bannerText,
  };
}
