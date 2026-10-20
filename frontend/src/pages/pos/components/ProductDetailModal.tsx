import { useState, useEffect } from 'react';
import {
  PlusIcon,
  MinusIcon,
  ShoppingCartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  PrinterIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { productsApi, competitorApi } from '../../../services/api';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { fmtPct } from '../../../utils/pricingConfig';
import { posImage } from '../../../utils/imageUrl';
import { escHtml, textWidthMm, printTicketHtml } from '../../../utils/ticket';
import {
  isProductOnSale,
  effectiveProductPrice,
  tradeNetPrice,
  TradeInfo,
} from '../../../store/slices/productsSlice';

interface ProductDetailModalProps {
  productId: number;
  fallbackProduct: {
    id: number;
    sku: string;
    name: string;
    price: number;
    specialPrice: number | null;
    specialPriceFrom?: string | null;
    specialPriceTo?: string | null;
    stockQty: number;
    isInStock: boolean;
    thumbnailUrl: string | null;
    brand?: string | null;
  };
  // Trade auto-discount keyed by productId, shared from POSPage so the
  // detail modal can render the same yellow "Trade $X" tag as the grid card.
  tradeMap?: Record<number, TradeInfo>;
  // Checkout promotion per product (fans 10%, Oct 2026).
  promoMap?: Record<number, { percent: number; label: string | null }>;
  // Fired after a manager/admin saves a new supplier cost, so the grid's
  // copy (and the cart margin guard) pick up the change.
  onCostUpdated?: (productId: number, cost: number | null) => void;
  // Fired after a manager/admin sets or clears this product's fixed
  // trade price, so the grid and cart re-fetch the trade rates.
  onTradePriceUpdated?: (productId: number, tradePrice: number | null) => void;
  onClose: () => void;
  onAddToCart: (
    product: {
      id: number;
      sku: string;
      name: string;
      price: number;
      specialPrice: number | null;
      specialPriceFrom?: string | null;
      specialPriceTo?: string | null;
      thumbnailUrl: string | null;
      isInStock?: boolean;
      stockQty?: number;
    },
    quantity: number,
  ) => void;
}

type Tab = 'specs' | 'competitors' | 'description';

export default function ProductDetailModal({
  productId,
  fallbackProduct,
  tradeMap,
  promoMap,
  onCostUpdated,
  onTradePriceUpdated,
  onClose,
  onAddToCart,
}: ProductDetailModalProps) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('specs');
  const [qty, setQty] = useState(1);
  const [galleryIdx, setGalleryIdx] = useState(0);
  // Shelf/price ticket print view (Avi, 9 Sep: "Print Ticket" button on
  // each product page — name, SKU and price).
  const [showTicket, setShowTicket] = useState(false);
  // Inline cost editor (Sally, 10 Sep: "a cost price edit field on the
  // product for admins/managers"). Only rendered when the API returned a
  // cost, which it does solely for manager/admin.
  const [editingCost, setEditingCost] = useState(false);
  const [costInput, setCostInput] = useState('');
  const [costSaving, setCostSaving] = useState(false);
  // Per-product trade price editor (Sally, 29 Sep 2026). Managers and
  // admins only; the server enforces the same.
  const authUser = useSelector((st: RootState) => st.auth.user);
  const canManagePrices =
    authUser?.role?.name === 'admin' || authUser?.role?.name === 'manager';
  const [editingTrade, setEditingTrade] = useState(false);
  const [tradeInput, setTradeInput] = useState('');
  const [tradeSaving, setTradeSaving] = useState(false);

  const [competitor, setCompetitor] = useState<any>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [, setCompetitorError] = useState<string | null>(null);
  // Weekly Price Watch prices from every competitor (Sally, 20 Oct 2026).
  const [watch, setWatch] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    productsApi
      .getProductDetail(productId)
      .then((r) => {
        if (cancelled) return;
        setDetail(r.data.data);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // Fetch competitor pricing when that tab is opened
  useEffect(() => {
    if (tab !== 'competitors' || competitor || competitorLoading) return;
    setCompetitorLoading(true);
    setCompetitorError(null);
    Promise.allSettled([
      competitorApi
        .getPrice(fallbackProduct.name, fallbackProduct.sku)
        .then((r) => setCompetitor(r.data?.data || r.data || {}))
        .catch((e) => {
          setCompetitor({});
          setCompetitorError(e.response?.data?.message || 'No competitor pricing found');
        }),
      competitorApi
        .getPrices(fallbackProduct.sku)
        .then((r) => setWatch(r.data?.data || []))
        .catch(() => setWatch([])),
    ]).finally(() => setCompetitorLoading(false));
  }, [tab, competitor, competitorLoading, fallbackProduct.name, fallbackProduct.sku]);

  const product = detail?.product || fallbackProduct;

  const saveTradePrice = async (clear: boolean) => {
    let value: number | null = null;
    if (!clear) {
      const n = parseFloat(tradeInput.trim());
      if (!Number.isFinite(n) || n <= 0) {
        toast.error('Enter a trade price above 0');
        return;
      }
      value = Math.round(n * 100) / 100;
    }
    setTradeSaving(true);
    try {
      let r;
      try {
        r = await productsApi.updateTradePrice(product.id, value, false);
      } catch (e: any) {
        const d = e.response?.data;
        // Under the minimum margin: an admin may approve it explicitly.
        if (d?.code !== 'BELOW_COST_FLOOR_CONFIRM') throw e;
        if (!window.confirm(`${d.message}\n\nSave this trade price anyway?`)) {
          return;
        }
        r = await productsApi.updateTradePrice(product.id, value, true);
      }
      const saved = r.data?.data?.tradePrice ?? null;
      setDetail((d: any) =>
        d?.product ? { ...d, product: { ...d.product, tradePrice: saved } } : d,
      );
      onTradePriceUpdated?.(product.id, saved);
      toast.success(r.data?.message || 'Trade price updated');
      setEditingTrade(false);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update trade price');
    } finally {
      setTradeSaving(false);
    }
  };

  const startEditCost = () => {
    setCostInput(product.cost != null ? Number(product.cost).toFixed(2) : '');
    setEditingCost(true);
  };

  const saveCost = async () => {
    const raw = costInput.trim();
    let cost: number | null = null;
    if (raw !== '') {
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Cost must be a number of 0 or more');
        return;
      }
      cost = Math.round(n * 100) / 100;
    }
    setCostSaving(true);
    try {
      const r = await productsApi.updateCost(product.id, cost);
      const saved = r.data?.data?.cost ?? cost;
      setDetail((d: any) =>
        d?.product ? { ...d, product: { ...d.product, cost: saved } } : d,
      );
      onCostUpdated?.(product.id, saved);
      toast.success(r.data?.message || 'Cost updated');
      setEditingCost(false);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update cost');
    } finally {
      setCostSaving(false);
    }
  };
  const gallery: string[] =
    detail?.gallery && detail.gallery.length > 0
      ? detail.gallery
      : product.thumbnailUrl
        ? [product.thumbnailUrl]
        : [];
  const specs = detail?.specs || [];

  const onSale = isProductOnSale(product);
  const effectivePrice = effectiveProductPrice(product);
  const ourPrice = Number(effectivePrice);
  // Every competitor price we know: the weekly Price Watch list, with the
  // live Online Lighting check replacing its weekly figure. Cheapest first.
  const compRows = (() => {
    const rows = (watch || []).map((w: any) => ({ ...w }));
    if (competitor?.price) {
      const live = {
        competitor: 'onlinelighting',
        label: 'Online Lighting',
        price: Number(competitor.price),
        url: competitor.url || null,
        checkedAt: competitor.checkedAt || null,
      };
      const i = rows.findIndex((r: any) => r.competitor === 'onlinelighting');
      if (i >= 0) rows[i] = live;
      else rows.push(live);
    }
    return rows.filter((r: any) => r.price > 0).sort((a: any, b: any) => a.price - b.price);
  })();
  const compPrice = compRows.length ? compRows[0].price : null;
  const diff = compPrice !== null ? ourPrice - compPrice : null;
  const diffPct =
    compPrice !== null && compPrice > 0 ? (diff! / compPrice) * 100 : null;

  const handleAdd = () => {
    // Out-of-stock items can still be added — the cashier will mark them
    // as Backorder in the payment sidebar. Surface a warning so they
    // don't forget.
    if (!product.isInStock || product.stockQty <= 0) {
      toast(
        'Out of stock — remember to tick "Backorder" on this line at checkout',
        { icon: 'ℹ️', duration: 5000 },
      );
    }
    onAddToCart(
      {
        id: product.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        specialPrice: product.specialPrice,
        specialPriceFrom: product.specialPriceFrom,
        specialPriceTo: product.specialPriceTo,
        thumbnailUrl: product.thumbnailUrl,
        isInStock: product.isInStock,
        stockQty: product.stockQty,
      },
      qty,
    );
    onClose();
  };

  const nextImage = () =>
    setGalleryIdx((i) => (i + 1) % Math.max(1, gallery.length));
  const prevImage = () =>
    setGalleryIdx((i) => (i - 1 + gallery.length) % Math.max(1, gallery.length));

  return (
    <div className="modal-backdrop">
      <div className="bg-pos-card w-full h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-start p-6 pb-4 border-b border-gray-700">
          <button onClick={onClose} className="modal-back-btn self-start">
            <ArrowLeftIcon className="h-5 w-5" /> Back
          </button>
          <div className="flex-1 px-6">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
              {(detail?.brand || fallbackProduct.brand) && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-primary-500/20 text-primary-300 border border-primary-500/40">
                  {detail?.brand || fallbackProduct.brand}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold mt-1">{product.name}</h2>
            <div className="flex items-center gap-3 mt-2">
              {onSale ? (
                <>
                  <span className="text-2xl font-bold text-primary-400">
                    ${Number(product.specialPrice).toFixed(2)}
                  </span>
                  {(product as any).everydayPrice ? (
                    // Eglo / Havit: shown like the website, "RRP" and no
                    // SALE tag (Sally, 17 Oct 2026).
                    <span className="text-gray-500">RRP ${Number(product.price).toFixed(2)}</span>
                  ) : (
                    <>
                      <span className="text-gray-500 line-through">
                        ${Number(product.price).toFixed(2)}
                      </span>
                      <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded">
                        SALE
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="text-2xl font-bold text-primary-400">
                    ${Number(product.price).toFixed(2)}
                  </span>
                  {/* Category-based SALE (no special price — Coolum):
                      badge only, price stays regular. */}
                  {(product as any).isOnSale === true && (
                    <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded">
                      SALE
                    </span>
                  )}
                </>
              )}
              {/* Checkout promotion, so staff can tell the customer before
                  ringing it up (Avi, 7 Oct 2026). */}
              {(() => {
                const promo = promoMap?.[product.id];
                if (!promo || !(promo.percent > 0)) return null;
                const promoPrice =
                  Math.round(effectiveProductPrice(product) * (1 - promo.percent / 100) * 100) / 100;
                return (
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 border border-emerald-500/50"
                    title={promo.label || 'Promotion'}
                  >
                    {fmtPct(promo.percent)}% off at checkout · ${promoPrice.toFixed(2)}
                  </span>
                );
              })()}
              {(() => {
                const tradeInfo = tradeMap?.[product.id];
                const pct = tradeInfo?.percent || 0;
                const rrp = Number(product.price);
                const fixedTrade =
                  product.tradePrice != null &&
                  Number(product.tradePrice) > 0 &&
                  Number(product.tradePrice) < rrp
                    ? Number(product.tradePrice)
                    : null;
                // The rule's % comes off the sale price when the rule says
                // so (all default rules since 8 Oct 2026, floored at cost
                // + margin by the server), else off the fixed retail. A
                // price set on the product wins over the % rules.
                const tradePrice =
                  fixedTrade != null ? fixedTrade : tradeNetPrice(product, tradeInfo);
                // Customer-price-wins: a deep sale below the trade rate
                // means trade pays the sale price — hide the dearer badge.
                const beatenBySale =
                  tradePrice != null && effectiveProductPrice(product) <= tradePrice;

                if (editingTrade) {
                  return (
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-yellow-300">Trade $</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        autoFocus
                        className="input w-28 py-0.5 text-sm"
                        value={tradeInput}
                        placeholder="inc GST"
                        disabled={tradeSaving}
                        onChange={(e) => setTradeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveTradePrice(false);
                          if (e.key === 'Escape') setEditingTrade(false);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-primary py-0.5 px-2 text-xs"
                        disabled={tradeSaving}
                        onClick={() => saveTradePrice(false)}
                      >
                        {tradeSaving ? 'Saving…' : 'Save'}
                      </button>
                      {fixedTrade != null && (
                        <button
                          type="button"
                          className="btn-secondary py-0.5 px-2 text-xs"
                          disabled={tradeSaving}
                          title="Remove the set price and go back to the trade % rules"
                          onClick={() => saveTradePrice(true)}
                        >
                          Use rule
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary py-0.5 px-2 text-xs"
                        disabled={tradeSaving}
                        onClick={() => setEditingTrade(false)}
                      >
                        Cancel
                      </button>
                    </span>
                  );
                }

                const openEditor = () => {
                  setTradeInput(tradePrice != null ? tradePrice.toFixed(2) : '');
                  setEditingTrade(true);
                };
                const label =
                  tradePrice == null
                    ? null
                    : `Trade $${tradePrice.toFixed(2)}`;
                const title =
                  fixedTrade != null
                    ? 'Trade price set for this product'
                    : `Trade price (${fmtPct(pct)}% off ${
                        tradeInfo?.baseOnSpecialPrice && onSale ? 'the sale price' : 'retail'
                      })`;
                const badge =
                  'text-xs font-bold px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-500/40';

                if (!canManagePrices) {
                  if (label == null || beatenBySale) return null;
                  return (
                    <span className={badge} title={title}>
                      {label}
                    </span>
                  );
                }
                return (
                  <button
                    type="button"
                    className={`${badge} inline-flex items-center gap-1 hover:border-yellow-300`}
                    title={`${label == null ? 'No trade price' : title} — click to change`}
                    onClick={openEditor}
                  >
                    {label == null
                      ? 'Set trade price'
                      : beatenBySale
                        ? `${label} (sale price is lower)`
                        : label}
                    {fixedTrade != null && <span className="font-normal opacity-80">· set</span>}
                    <PencilSquareIcon className="h-3.5 w-3.5" />
                  </button>
                );
              })()}
              {/* Cost — only present when the API returned it (manager/admin
                  only; the backend strips it for sales_staff). */}
              {product.cost != null && !editingCost && (
                <button
                  type="button"
                  className="text-xs font-bold px-2 py-0.5 rounded bg-gray-600/30 text-gray-300 border border-gray-500/40 inline-flex items-center gap-1 hover:border-primary-400 hover:text-primary-300"
                  title="Supplier cost (inc GST) — click to change"
                  onClick={startEditCost}
                >
                  Cost ${Number(product.cost).toFixed(2)}
                  <PencilSquareIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {/* No cost loaded for this product (about a third of the
                  range, Sally 1 Oct 2026) — let managers/admins add one
                  here instead of waiting for the next price-list import. */}
              {product.cost == null && canManagePrices && !editingCost && (
                <button
                  type="button"
                  className="text-xs font-bold px-2 py-0.5 rounded bg-gray-600/20 text-gray-400 border border-dashed border-gray-500/60 inline-flex items-center gap-1 hover:border-primary-400 hover:text-primary-300"
                  title="No cost price loaded for this product — click to enter one (inc GST)"
                  onClick={startEditCost}
                >
                  Set cost
                  <PencilSquareIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {editingCost && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-xs text-gray-400">Cost $</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    autoFocus
                    className="input w-28 py-0.5 text-sm"
                    value={costInput}
                    placeholder="inc GST"
                    disabled={costSaving}
                    onChange={(e) => setCostInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCost();
                      if (e.key === 'Escape') setEditingCost(false);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-primary py-0.5 px-2 text-xs"
                    disabled={costSaving}
                    onClick={saveCost}
                  >
                    {costSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary py-0.5 px-2 text-xs"
                    disabled={costSaving}
                    onClick={() => setEditingCost(false)}
                  >
                    Cancel
                  </button>
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  product.isInStock
                    ? 'bg-green-600/30 text-green-300'
                    : 'bg-red-600/30 text-red-300'
                }`}
              >
                {product.isInStock ? `In Stock: ${product.stockQty}` : 'Out of Stock'}
              </span>
            </div>
          </div>
        </div>

        {/* Body: gallery + tabs */}
        <div className="flex-1 overflow-auto flex">
          {/* Gallery column */}
          <div className="w-1/2 p-6 border-r border-gray-700 flex flex-col">
            <div className="relative flex-1 min-h-[260px] bg-pos-dark rounded-lg overflow-hidden flex items-center justify-center">
              {gallery.length > 0 ? (
                <img
                  src={posImage(gallery[galleryIdx]) || undefined}
                  alt={product.name}
                  className="max-h-[340px] w-auto object-contain"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.onerror = null;
                    img.style.display = 'none';
                    const parent = img.parentElement;
                    if (parent && !parent.querySelector('[data-img-fallback]')) {
                      const fb = document.createElement('span');
                      fb.dataset.imgFallback = 'true';
                      fb.className = 'text-gray-500';
                      fb.textContent = 'Image unavailable';
                      parent.appendChild(fb);
                    }
                  }}
                />
              ) : (
                <span className="text-gray-500">No Image</span>
              )}
              {gallery.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 rounded-full p-1"
                  >
                    {/* white in both themes — sits on the bg-black/50 overlay */}
                    <ChevronLeftIcon className="h-5 w-5 text-white" />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 rounded-full p-1"
                  >
                    <ChevronRightIcon className="h-5 w-5 text-white" />
                  </button>
                </>
              )}
            </div>
            {gallery.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto">
                {gallery.map((url, i) => (
                  <button
                    key={url + i}
                    onClick={() => setGalleryIdx(i)}
                    className={`flex-shrink-0 w-16 h-16 rounded border-2 overflow-hidden ${
                      i === galleryIdx ? 'border-primary-500' : 'border-gray-700'
                    }`}
                  >
                    <img src={posImage(url) || undefined} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tabs column */}
          <div className="w-1/2 flex flex-col">
            <div className="flex border-b border-gray-700">
              {[
                { id: 'specs', label: 'Specifications' },
                { id: 'competitors', label: 'Competitor Pricing' },
                { id: 'description', label: 'Description' },
              ].map((t) => (
                <button
                  key={t.id}
                  className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-primary-500 text-pos-text'
                      : 'border-transparent text-gray-400 hover:text-pos-text'
                  }`}
                  onClick={() => setTab(t.id as Tab)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-4 text-sm">
              {tab === 'specs' && (
                <>
                  {loading ? (
                    <p className="text-gray-400">Loading specs...</p>
                  ) : specs.length === 0 ? (
                    <p className="text-gray-400">
                      {detail?.liveError || 'No specifications available for this product.'}
                    </p>
                  ) : (
                    <dl className="divide-y divide-gray-700">
                      {specs.map((s: any) => (
                        <div key={s.code} className="py-2 flex justify-between gap-4">
                          <dt className="text-gray-400">{s.label}</dt>
                          <dd className="text-right font-medium">{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              )}

              {tab === 'competitors' && (
                <>
                  {competitorLoading ? (
                    <p className="text-gray-400">Checking competitor pricing...</p>
                  ) : compRows.length > 0 ? (
                    <div className="space-y-3">
                      {/* Plain price-comparison table — just the numbers
                          and a link, no "we are more expensive" editorial
                          (Sally's request). All competitors, cheapest first
                          (20 Oct 2026). */}
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-gray-700">
                            <th className="py-2 font-medium">Source</th>
                            <th className="py-2 font-medium text-right">Price</th>
                            <th className="py-2 font-medium text-right">Checked</th>
                            <th className="py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-gray-800">
                            <td className="py-2 font-medium">Our Price</td>
                            <td className="py-2 text-right font-bold text-primary-400">
                              ${ourPrice.toFixed(2)}
                            </td>
                            <td></td>
                            <td></td>
                          </tr>
                          {compRows.map((r: any, i: number) => (
                            <tr key={r.competitor} className="border-b border-gray-800 last:border-0">
                              <td className="py-2">
                                {r.label}
                                {i === 0 && (
                                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-600/20 text-green-500">
                                    Cheapest
                                  </span>
                                )}
                              </td>
                              <td className="py-2 text-right font-bold">${r.price.toFixed(2)}</td>
                              <td className="py-2 text-right text-xs text-gray-500">
                                {r.checkedAt ? new Date(r.checkedAt).toLocaleDateString('en-AU') : ''}
                              </td>
                              <td className="py-2 text-right">
                                {r.url && (
                                  <a
                                    href={r.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary-400 underline"
                                  >
                                    Link
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Neutral, factual difference to the cheapest. */}
                      {diff !== 0 && diff !== null && (
                        <p className={`text-xs ${diff < 0 ? 'text-green-300' : 'text-orange-300'}`}>
                          {diff < 0
                            ? `$${Math.abs(diff).toFixed(2)} lower than the cheapest (${Math.abs(diffPct!).toFixed(1)}%)`
                            : `$${diff.toFixed(2)} higher than the cheapest (${diffPct!.toFixed(1)}%)`}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-500">
                        Weekly Price Watch prices; Online Lighting is checked live.
                      </p>
                    </div>
                  ) : (
                    <div className="text-gray-400">
                      <p>No competitor match found.</p>
                      <p className="text-xs mt-2">
                        None of the competitors in the weekly Price Watch list this SKU, and Online Lighting
                        doesn't have it.
                      </p>
                    </div>
                  )}
                </>
              )}

              {tab === 'description' && (
                <>
                  {loading ? (
                    <p className="text-gray-400">Loading...</p>
                  ) : product.description || product.shortDescription ? (
                    <div className="space-y-3 text-gray-300">
                      {product.shortDescription && (
                        <p className="italic">{product.shortDescription}</p>
                      )}
                      {product.description && (
                        <p className="whitespace-pre-wrap">{product.description}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-400">No description available.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer: qty + add to cart */}
        <div className="flex justify-between items-center p-4 border-t border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Qty:</span>
            <button
              className="p-1 bg-pos-accent rounded hover:bg-gray-600"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              <MinusIcon className="h-4 w-4" />
            </button>
            <input
              type="number"
              min={1}
              className="input w-16 text-center py-1 px-2"
              value={qty}
              onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button
              className="p-1 bg-pos-accent rounded hover:bg-gray-600"
              onClick={() => setQty((q) => q + 1)}
            >
              <PlusIcon className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-400 ml-4">
              Price: ${(ourPrice * qty).toFixed(2)}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary flex items-center gap-2"
              onClick={() => setShowTicket(true)}
              title="Print a shelf ticket — product name, SKU and price"
            >
              <PrinterIcon className="h-5 w-5" />
              Print Ticket
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleAdd}
            >
              <ShoppingCartIcon className="h-5 w-5" />
              {product.isInStock && product.stockQty > 0
                ? 'Add to Cart'
                : 'Add as Backorder'}
            </button>
          </div>
        </div>
      </div>

      {/* Shelf ticket — Sally's label stock, 89mm wide x 36mm high.
          The preview is drawn at true size from the same HTML that gets
          printed. Printing happens in a separate one-page document
          (printSaleTicket): printed from inside this full-screen modal,
          the hidden POS underneath still took up room, the job ran to a
          second label, and Chrome repeats fixed-position content on every
          page — so the ticket came out twice (Sally, 12 Oct 2026). */}
      {showTicket && (
        <div className="modal-backdrop-top">
          <div className="m-auto flex flex-col items-center gap-4">
            <div
              className="shadow-lg"
              dangerouslySetInnerHTML={{ __html: saleTicketHtml(product, onSale, !!(product as any).everydayPrice) }}
            />

            <p className="text-xs text-gray-400">
              Actual size: 89mm wide × 36mm high
            </p>

            <div className="flex gap-3 w-64">
              <button
                className="btn-secondary flex-1"
                onClick={() => setShowTicket(false)}
              >
                Close
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={() => printSaleTicket(product, onSale, !!(product as any).everydayPrice)}
              >
                <PrinterIcon className="h-5 w-5" />
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sale ticket
type TicketProduct = {
  name: string;
  sku: string;
  price: number | string;
  specialPrice: number | string | null;
};

// The 89 x 36 mm ticket as self-contained HTML (inline styles only, so the
// print document needs no app CSS). Layout per Sally, 12 Oct 2026: "put
// sku top left corner and price then can be bigger" — SKU top-left, the
// name under it (2 lines max), and the price across the full width as big
// as it fits.
// rrp: Eglo / Havit — the full price is printed as "RRP", not SALE.
function saleTicketHtml(p: TicketProduct, onSale: boolean, rrp = false): string {
  const shown = Number(onSale ? p.specialPrice : p.price);
  const text = `$${shown.toFixed(2)}`;
  const was = `$${Number(p.price).toFixed(2)}`;
  // Price as big as fits: the label is 83mm wide inside its padding, less
  // the was-price / SALE block on a sale ticket, and the height allows up
  // to ~56pt. Measured, not estimated, so four-figure prices never clip.
  const saleMm = onSale
    ? Math.max(textWidthMm(was, '{size} Arial, Helvetica, sans-serif', 10), textWidthMm('SALE', 'bold {size} Arial, Helvetica, sans-serif', 10) + 4) + 3
    : 0;
  const availMm = 83 - saleMm - 1.5;
  const perPt = textWidthMm(text, 'bold {size} Arial, Helvetica, sans-serif', 1) * 0.98; // letter-spacing -0.02em
  const pt = Math.max(20, Math.floor(Math.min(56, availMm / perPt)));
  const sale = !onSale
    ? ''
    : rrp
      ? `<div style="text-align:right;padding-bottom:1.6mm;white-space:nowrap">
           <div style="font-size:8pt;color:#333;letter-spacing:0.12em">RRP</div>
           <div style="font-size:10pt;color:#333">${was}</div>
         </div>`
      : `<div style="text-align:right;padding-bottom:1.6mm;white-space:nowrap">
           <div style="font-size:10pt;color:#333;text-decoration:line-through">${was}</div>
           <div style="font-size:10pt;font-weight:700;letter-spacing:0.12em">SALE</div>
         </div>`;
  return `<div style="width:89mm;height:36mm;box-sizing:border-box;padding:2mm 3mm;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;overflow:hidden">
    <div style="font-family:'Courier New',monospace;font-weight:700;font-size:8.5pt;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.sku)}</div>
    <div style="font-weight:700;font-size:9.5pt;line-height:1.15;margin-top:0.8mm;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(p.name)}</div>
    <div style="flex:1;min-height:0;display:flex;align-items:flex-end;justify-content:flex-end;gap:2.5mm">
      ${sale}
      <div style="font-weight:700;font-size:${pt}pt;line-height:0.9;letter-spacing:-0.02em;white-space:nowrap">${text}</div>
    </div>
  </div>`;
}

function printSaleTicket(p: TicketProduct, onSale: boolean, rrp = false) {
  printTicketHtml(p.sku, saleTicketHtml(p, onSale, rrp));
}
