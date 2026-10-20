import { DataSource } from 'typeorm';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface CompetitorPrice {
  price: number | null;
  url: string | null;
  source: string;
  error?: string;
}

interface SitemapProduct {
  url: string;
  slug: string;
  tokens: string[];
  skus: string[];
}

const WATCH_LABELS: Record<string, string> = {
  onlinelighting: 'Online Lighting',
  bestbuylighting: 'Best Buy Lighting',
  lights4less: 'Lights4Less',
  lightingillusions: 'Lighting Illusions',
  ceilingfansdirect: 'Ceiling Fans Direct',
  harveynormanlighting: 'Harvey Norman Lighting',
  ceilingfanswarehouse: 'Ceiling Fans Warehouse',
};

@Injectable()
export class CompetitorService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  // Every competitor's latest price for a SKU from the weekly Price Watch
  // scrape, cheapest first (Sally, 20 Oct 2026: the product's Competitor
  // Pricing tab should list all competitors, not just Online Lighting).
  async getWatchPrices(sku: string): Promise<
    Array<{ competitor: string; label: string; price: number; url: string | null; checkedAt: string | null }>
  > {
    const s = (sku || '').trim();
    if (!s) return [];
    const rows: any[] = await this.dataSource.query(
      `SELECT c.competitor, c.price, c.url, r.finished_at checkedAt
         FROM competitor_price_snapshots c
         JOIN (SELECT competitor, MAX(run_id) run_id FROM competitor_price_snapshots
                WHERE sku = ? GROUP BY competitor) latest
           ON latest.competitor = c.competitor AND latest.run_id = c.run_id
         LEFT JOIN scrape_runs r ON r.id = c.run_id
        WHERE c.sku = ?
        ORDER BY c.price ASC`,
      [s, s],
    );
    return rows.map((r) => ({
      competitor: r.competitor,
      label: WATCH_LABELS[r.competitor] || r.competitor,
      price: Number(r.price),
      url: r.url || null,
      checkedAt: r.checkedAt ? new Date(r.checkedAt).toISOString() : null,
    }));
  }

  private readonly logger = new Logger(CompetitorService.name);

  // Sitemap-based product index
  private productIndex: SitemapProduct[] = [];
  private indexLoaded = false;
  private indexLoading = false;

  // Price cache: productName -> { result, timestamp }
  private cache = new Map<string, { result: CompetitorPrice; timestamp: number }>();
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour
  private readonly SITEMAP_REFRESH = 1000 * 60 * 60 * 24; // 24 hours
  private lastSitemapLoad = 0;

  async onModuleInit() {
    // Load sitemap index in background on startup
    this.loadSitemapIndex().catch((err) =>
      this.logger.warn(`Initial sitemap load failed: ${err.message}`),
    );
  }

  async getCompetitorPrice(productName: string, sku?: string): Promise<CompetitorPrice> {
    // Check cache first
    const cacheKey = (sku || productName).toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.result;
    }

    // Ensure index is loaded
    if (!this.indexLoaded) {
      await this.loadSitemapIndex();
    }

    // Refresh sitemap if stale
    if (Date.now() - this.lastSitemapLoad > this.SITEMAP_REFRESH) {
      this.loadSitemapIndex().catch(() => {});
    }

    try {
      // Step 1: Find matching product in sitemap index
      const productUrl = this.findProduct(productName, sku);
      if (!productUrl) {
        const result: CompetitorPrice = {
          price: null,
          url: null,
          source: 'onlinelighting.com.au',
          error: 'Product not found on competitor site',
        };
        this.cache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      }

      // Step 2: Scrape the product page for price
      const price = await this.scrapePrice(productUrl);
      const result: CompetitorPrice = {
        price,
        url: productUrl,
        source: 'onlinelighting.com.au',
        error: price === null ? 'Could not extract price' : undefined,
      };

      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get competitor price for "${productName}": ${error.message}`,
      );
      return {
        price: null,
        url: null,
        source: 'onlinelighting.com.au',
        error: 'Failed to fetch competitor price',
      };
    }
  }

  private async loadSitemapIndex(): Promise<void> {
    if (this.indexLoading) return;
    this.indexLoading = true;

    try {
      this.logger.log('Loading competitor sitemap...');
      const { data } = await axios.get(
        'https://onlinelighting.com.au/sitemap.xml',
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 30000,
        },
      );

      const urls = [
        ...data.matchAll(
          /<loc>(https:\/\/onlinelighting\.com\.au\/([^<]*\.html))<\/loc>/g,
        ),
      ];

      this.productIndex = urls.map((m: RegExpMatchArray) => {
        const url = m[1];
        const slug = m[2].replace('.html', '');
        const tokens = slug.split('-').map((t: string) => t.toLowerCase());
        // Extract SKU-like values: pure numbers (4+ digits) or letter+number combos
        const skus = tokens.filter(
          (t: string) => /^\d{4,}$/.test(t) || /^[a-z]{1,4}\d{3,}/i.test(t),
        );
        return { url, slug, tokens, skus };
      });

      this.indexLoaded = true;
      this.lastSitemapLoad = Date.now();
      this.logger.log(
        `Competitor sitemap loaded: ${this.productIndex.length} products`,
      );
    } catch (error) {
      this.logger.error(`Failed to load sitemap: ${error.message}`);
    } finally {
      this.indexLoading = false;
    }
  }

  private findProduct(productName: string, sku?: string): string | null {
    if (this.productIndex.length === 0) return null;

    // Strategy 1: Match by SKU if provided
    if (sku) {
      // Clean the SKU: remove brand prefixes like "Eglo.", take last segment
      const skuParts = sku
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .trim()
        .split(/\s+/);
      for (const part of skuParts) {
        const skuLower = part.toLowerCase();
        if (skuLower.length < 3) continue;
        const match = this.productIndex.find(
          (p) =>
            p.skus.includes(skuLower) ||
            p.tokens.includes(skuLower) ||
            p.slug.includes(skuLower),
        );
        if (match) return match.url;
      }
    }

    // Strategy 2: Match by product name keywords
    const nameTokens = productName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    // Remove common generic words
    const stopWords = new Set([
      'the',
      'and',
      'with',
      'for',
      'led',
      'light',
      'lamp',
      'range',
      'modern',
      'new',
    ]);
    const keywords = nameTokens.filter((t) => !stopWords.has(t));

    if (keywords.length === 0) return null;

    // Score each product by keyword match count
    let bestMatch: SitemapProduct | null = null;
    let bestScore = 0;

    for (const product of this.productIndex) {
      let score = 0;
      const slugStr = product.tokens.join(' ');
      for (const kw of keywords) {
        if (slugStr.includes(kw)) score++;
      }
      // Require at least 2 keyword matches or 50% of keywords
      const threshold = Math.max(2, Math.ceil(keywords.length * 0.4));
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }

    return bestMatch?.url || null;
  }

  private async scrapePrice(productUrl: string): Promise<number | null> {
    try {
      const { data } = await axios.get(productUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-AU,en;q=0.9',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(data);

      // Try multiple selectors for price extraction
      // onlinelighting.com.au uses CS-Cart with .product-price-actual and .ty-price classes
      const priceSelectors = [
        '.product-price-actual',
        '.price-discounted.ty-price',
        '.ty-price-num',
        '.price-wrapper .price',
        '.product-info-price .price',
        '.special-price .price',
        '.normal-price .price',
        'span.price',
        '[data-price-amount]',
        '.price-box .price',
        'meta[property="product:price:amount"]',
      ];

      for (const selector of priceSelectors) {
        const el = $(selector).first();
        if (el.length) {
          // Check for meta tag (content attribute)
          if (selector.includes('meta')) {
            const content = el.attr('content');
            if (content) {
              const price = parseFloat(content);
              if (!isNaN(price) && price > 0) return price;
            }
            continue;
          }

          // Check data attribute
          const dataPrice = el.attr('data-price-amount');
          if (dataPrice) {
            const price = parseFloat(dataPrice);
            if (!isNaN(price) && price > 0) return price;
          }

          // Parse text content like "AU$2,199.00" or "$199.00"
          const text = el.text().trim();
          const priceMatch = text.match(/\$?\s?([\d,]+\.?\d*)/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (!isNaN(price) && price > 0) return price;
          }
        }
      }

      // Fallback: search for JSON-LD structured data
      let ldPrice: number | null = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        if (ldPrice) return;
        try {
          const json = JSON.parse($(el).html() || '');
          if (json['@type'] === 'Product' && json.offers) {
            const offers = Array.isArray(json.offers)
              ? json.offers[0]
              : json.offers;
            if (offers.price) {
              ldPrice = parseFloat(offers.price);
            }
          }
        } catch {
          // ignore parse errors
        }
      });

      return ldPrice;
    } catch (error) {
      this.logger.warn(
        `Failed to scrape price from ${productUrl}: ${error.message}`,
      );
      return null;
    }
  }
}
