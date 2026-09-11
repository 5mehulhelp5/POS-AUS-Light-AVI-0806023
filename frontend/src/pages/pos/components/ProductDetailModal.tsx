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
import {
  isProductOnSale,
  effectiveProductPrice,
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
  // Trade auto-discount % keyed by productId, shared from POSPage so the
  // detail modal can render the same yellow "Trade $X" tag as the grid card.
  tradePctMap?: Record<number, number>;
  // Fired after a manager/admin saves a new supplier cost, so the grid's
  // copy (and the cart margin guard) pick up the change.
  onCostUpdated?: (productId: number, cost: number | null) => void;
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
  tradePctMap,
  onCostUpdated,
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

  const [competitor, setCompetitor] = useState<any>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorError, setCompetitorError] = useState<string | null>(null);

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
    competitorApi
      .getPrice(fallbackProduct.name, fallbackProduct.sku)
      .then((r) => setCompetitor(r.data?.data || r.data))
      .catch((e) => {
        setCompetitorError(
          e.response?.data?.message || 'No competitor pricing found',
        );
      })
      .finally(() => setCompetitorLoading(false));
  }, [tab, competitor, competitorLoading, fallbackProduct.name, fallbackProduct.sku]);

  const product = detail?.product || fallbackProduct;

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
  const compPrice = competitor?.price ? Number(competitor.price) : null;
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
                  <span className="text-gray-500 line-through">
                    ${Number(product.price).toFixed(2)}
                  </span>
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded">
                    SALE
                  </span>
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
              {(() => {
                const pct = tradePctMap?.[product.id] || 0;
                if (pct <= 0) return null;
                // Trade base is always the fixed retail (product.price)
                // so trade never stacks on top of an active SALE price.
                const tradePrice =
                  Math.round(Number(product.price) * (1 - pct / 100) * 100) / 100;
                // Customer-price-wins: a deep sale below the trade rate
                // means trade pays the sale price — hide the dearer badge.
                if (effectiveProductPrice(product) <= tradePrice) return null;
                return (
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-500/40"
                    title={`Trade price (${pct}% off)`}
                  >
                    Trade ${tradePrice.toFixed(2)}
                  </span>
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
                  src={gallery[galleryIdx]}
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
                    <img src={url} alt="" className="w-full h-full object-contain" />
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
                  ) : competitorError ? (
                    <div className="text-gray-400">
                      <p>{competitorError}</p>
                      <p className="text-xs mt-2">
                        We compare against onlinelighting.com.au by SKU and name.
                      </p>
                    </div>
                  ) : compPrice !== null ? (
                    <div className="space-y-3">
                      {/* Plain price-comparison table — just the numbers
                          and a link, no "we are more expensive" editorial
                          (Sally's request). */}
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-gray-700">
                            <th className="py-2 font-medium">Source</th>
                            <th className="py-2 font-medium text-right">Price</th>
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
                          </tr>
                          <tr>
                            <td className="py-2">Online Lighting</td>
                            <td className="py-2 text-right font-bold">
                              ${compPrice.toFixed(2)}
                            </td>
                            <td className="py-2 text-right">
                              {competitor.url && (
                                <a
                                  href={competitor.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary-400 underline"
                                >
                                  Link
                                </a>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      {/* Neutral, factual difference — coloured but not
                          worded as a judgement. */}
                      {diff !== 0 && (
                        <p
                          className={`text-xs ${
                            diff! < 0 ? 'text-green-300' : 'text-orange-300'
                          }`}
                        >
                          {diff! < 0
                            ? `$${Math.abs(diff!).toFixed(2)} lower (${Math.abs(diffPct!).toFixed(1)}%)`
                            : `$${diff!.toFixed(2)} higher (${diffPct!.toFixed(1)}%)`}
                        </p>
                      )}
                      {competitor.checkedAt && (
                        <p className="text-[11px] text-gray-500">
                          Last checked: {new Date(competitor.checkedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-400">No competitor match found.</p>
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

      {/* Shelf ticket print view — name, SKU, price (Avi, 9 Sep).
          Sized to Sally's label stock (10 Sep): 36mm high x 89mm wide.
          The ticket is drawn at true physical size on screen and the
          injected @page rule makes the print page exactly that size
          with no margin, so it prints 1:1 on the label printer.
          printable-root isolates it during print so only the ticket
          comes out; .paper keeps it black-on-white in both themes. */}
      {showTicket && (
        <div className="modal-backdrop-top print:bg-white print:static">
          <style>{`@page { size: 89mm 36mm; margin: 0; }`}</style>
          <div className="m-auto flex flex-col items-center gap-4 print:m-0 print:block">
            <div
              className="paper printable-root bg-white text-black overflow-hidden flex items-stretch"
              style={{
                width: '89mm',
                height: '36mm',
                padding: '2mm 3mm',
                fontFamily: 'Arial, Helvetica, sans-serif',
              }}
            >
              {/* Left: store, name, SKU */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <p
                  className="uppercase text-gray-600 truncate"
                  style={{ fontSize: '6pt', letterSpacing: '0.12em' }}
                >
                  Australian Lighting &amp; Fans
                </p>
                <p
                  className="font-bold"
                  style={{
                    fontSize: '9.5pt',
                    lineHeight: 1.15,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {product.name}
                </p>
                <p className="font-mono text-gray-700 truncate" style={{ fontSize: '7pt' }}>
                  SKU {product.sku}
                </p>
              </div>

              {/* Right: price */}
              <div
                className="flex flex-col items-end justify-center text-right shrink-0"
                style={{ paddingLeft: '2mm', minWidth: '28mm' }}
              >
                {onSale ? (
                  <>
                    <p className="text-gray-600 line-through" style={{ fontSize: '7pt' }}>
                      ${Number(product.price).toFixed(2)}
                    </p>
                    <p className="font-extrabold" style={{ fontSize: '20pt', lineHeight: 1 }}>
                      ${Number(product.specialPrice).toFixed(2)}
                    </p>
                    <p className="font-bold uppercase" style={{ fontSize: '7pt', letterSpacing: '0.1em' }}>
                      Sale
                    </p>
                  </>
                ) : (
                  <p className="font-extrabold" style={{ fontSize: '20pt', lineHeight: 1 }}>
                    ${Number(product.price).toFixed(2)}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-gray-400 print:hidden">
              Actual size: 89mm wide × 36mm high
            </p>

            <div className="flex gap-3 w-64 print:hidden">
              <button
                className="btn-secondary flex-1"
                onClick={() => setShowTicket(false)}
              >
                Close
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={() => window.print()}
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
