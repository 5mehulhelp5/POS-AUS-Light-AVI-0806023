import { useEffect, useMemo, useState } from 'react';
import {
  XMarkIcon,
  ScissorsIcon,
  ClipboardDocumentIcon,
  PaperAirplaneIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { settingsApi } from '../../../services/api';

// Cut-to-length LED strip catalogue. Rates live in the `led_strip_products`
// setting so an admin can edit them under Settings → LED Strip without a
// deploy; the array below is only the fallback used when that request
// fails. Prices are per metre GST-inclusive; the trade rate applies when
// the cashier flips the top-right pill.
interface StripProduct {
  id: string;
  name: string;
  retailPerM: number;
  tradePerM: number;
  // Only cuttable at multiples of this many mm. 500 = 0.5m cuts, the
  // standard interval for strip lighting.
  cutMm: number;
  // Longest single continuous run (limited by voltage drop). Longer
  // orders warn the cashier but are never blocked — trade buy 100m+.
  maxRunM: number;
  // How many metres of lead tail are included free with each strip,
  // and the per-metre charge for anything above that.
  includedTailM: number;
  tailPerM: number;
}

// Representative subset of the Havit per-metre range (Aug 2026) — the
// full 165-variant catalogue lives in the led_strip_products setting.
const FALLBACK_STRIP_PRODUCTS: StripProduct[] = [
  {
    id: 'HV9783-IP20-160-3K',
    name: '2W 2835 Strip Lighting - IP20 / Per Metre - 3000K',
    retailPerM: 15.1525,
    tradePerM: 10.9725,
    cutMm: 500,
    maxRunM: 1000,
    includedTailM: 1,
    tailPerM: 2.5,
  },
  {
    id: 'HV9760-IP20-320-3K',
    name: '4.8w IP20 24v DC 3000K COB Dotless LED Strip - Per Metre',
    retailPerM: 15.1525,
    tradePerM: 10.9725,
    cutMm: 500,
    maxRunM: 1000,
    includedTailM: 1,
    tailPerM: 2.5,
  },
  {
    id: 'HV9760-IP67-320-3K',
    name: '9.6w IP67 24v DC 3000K COB Dotless LED Strip - Per Metre',
    retailPerM: 25.201,
    tradePerM: 18.249,
    cutMm: 500,
    maxRunM: 1000,
    includedTailM: 1,
    tailPerM: 2.5,
  },
  {
    id: 'HV9723-IP20-240-3K-1',
    name: '19.2w IP20 LED Strip 3000k - Per Metre',
    retailPerM: 46.893,
    tradePerM: 33.957,
    cutMm: 500,
    maxRunM: 1000,
    includedTailM: 1,
    tailPerM: 2.5,
  },
];

// "Custom strip" — a strip that isn't in the admin list yet (Sally, 12
// Oct 2026: "we've still got strip lighting that we haven't uploaded ...
// we need a custom in here so that we can enter manually what strip
// lighting it needs to be"). Its name, SKU and rates are typed in.
const CUSTOM_ID = '__custom__';
const CUT_OPTIONS = [
  { mm: 1, label: 'Exact length (no rounding)' },
  { mm: 50, label: 'Every 50mm' },
  { mm: 100, label: 'Every 100mm' },
  { mm: 500, label: 'Every 0.5m' },
  { mm: 1000, label: 'Every 1m' },
];
const toNum = (v: string): number => {
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Show anything a metre or longer in metres, shorter in mm — Sally:
// "once exceed over 1m the mm's convert into 1m".
const formatLength = (mm: number): string => {
  if (mm >= 1000) {
    const m = mm / 1000;
    // Trim trailing zeros: 3.00m -> 3m, 3.50m -> 3.5m
    return `${parseFloat(m.toFixed(3))}m`;
  }
  return `${Math.round(mm)}mm`;
};

interface OrderLine {
  id: number;
  product: StripProduct;
  lengthMm: number;
  suppliedLengthM: number;
  tailM: number;
  qty: number;
  linePrice: number;
  perM: number;
  isTrade: boolean;
}

interface Props {
  onClose: () => void;
  // Cart's trade flag. The modal used to open on retail every time, so
  // trade customers were quoted retail per-metre rates unless the
  // cashier remembered the toggle (Sally, 10 Sep: "Trade prices not
  // being applied to led strip lighting").
  defaultTrade?: boolean;
  onSendToCart: (
    lines: Array<{ sku: string; name: string; price: number }>,
  ) => void;
}

const money = (n: number) =>
  n.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  });

export default function StripCutModal({ onClose, defaultTrade = false, onSendToCart }: Props) {
  const [products, setProducts] = useState<StripProduct[]>(
    FALLBACK_STRIP_PRODUCTS,
  );
  const [productId, setProductId] = useState(FALLBACK_STRIP_PRODUCTS[0].id);
  // Searchable product picker — 165 strips is too many for a bare
  // <select>. While open, the input holds the filter query; closed, it
  // shows the selected product's name.
  const [productQuery, setProductQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Entered in METRES (decimals fine — 3.2 = 3200mm); converted to mm
  // internally for the cut-point rounding.
  const [lengthMStr, setLengthMStr] = useState('');
  const [tailMStr, setTailMStr] = useState('1');
  // How many identical cut strips (Sally, 7 Sep: "add 4x 1m led strip").
  const [qtyStr, setQtyStr] = useState('1');
  const [isTrade, setIsTrade] = useState(defaultTrade);
  const [order, setOrder] = useState<OrderLine[]>([]);
  // Custom strip fields (used when productId === CUSTOM_ID).
  const [customName, setCustomName] = useState('');
  const [customSku, setCustomSku] = useState('');
  const [customRetail, setCustomRetail] = useState('');
  const [customTrade, setCustomTrade] = useState('');
  const [customCutMm, setCustomCutMm] = useState(500);
  const [customTailIncl, setCustomTailIncl] = useState('1');
  const [customTailPerM, setCustomTailPerM] = useState('2.50');

  // Pull admin-maintained rates. Falls back to the built-in list on
  // failure so the counter still works if settings are unreachable.
  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getLedStripProducts()
      .then((r) => {
        if (cancelled) return;
        const list = r.data?.data?.products;
        if (Array.isArray(list) && list.length > 0) {
          setProducts(list);
          // Keep the current selection if it still exists, else reset.
          setProductId((cur) =>
            list.some((p: StripProduct) => p.id === cur) ? cur : list[0].id,
          );
        }
      })
      .catch(() => {
        /* keep fallback catalogue */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isCustom = productId === CUSTOM_ID;
  const customProduct = useMemo<StripProduct>(() => {
    const retail = toNum(customRetail);
    // Trade left blank = same as retail.
    const trade = customTrade.trim() ? toNum(customTrade) : retail;
    return {
      id: customSku.trim() || 'CUSTOM',
      name: customName.trim() || 'Custom LED strip',
      retailPerM: retail,
      tradePerM: trade,
      cutMm: customCutMm,
      maxRunM: 1000,
      includedTailM: toNum(customTailIncl),
      tailPerM: toNum(customTailPerM),
    };
  }, [customName, customSku, customRetail, customTrade, customCutMm, customTailIncl, customTailPerM]);
  const product = isCustom
    ? customProduct
    : products.find((p) => p.id === productId) ?? products[0] ?? FALLBACK_STRIP_PRODUCTS[0];
  const perM = isTrade ? product.tradePerM : product.retailPerM;

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [products, productQuery]);

  // Round the requested length up to the next cut point, then compute
  // supplied metres + tail metres + total line price.
  const calc = useMemo(() => {
    const lengthM = Math.max(0, Number(lengthMStr) || 0);
    const lengthMm = Math.round(lengthM * 1000);
    const tailM = Math.max(0, Number(tailMStr) || 0);
    const suppliedMm = lengthMm > 0
      ? Math.ceil(lengthMm / product.cutMm) * product.cutMm
      : 0;
    const suppliedM = suppliedMm / 1000;
    const extraTailM = Math.max(0, tailM - product.includedTailM);
    const qty = Math.max(1, Math.round(Number(qtyStr) || 1));
    // Per-strip price × qty — each strip gets its own included tail.
    const stripPrice = suppliedM * perM * qty;
    const tailPrice = extraTailM * product.tailPerM * qty;
    const linePrice = stripPrice + tailPrice;
    const exceedsMaxRun = suppliedM > product.maxRunM;
    return {
      lengthMm,
      tailM,
      qty,
      suppliedMm,
      suppliedM,
      extraTailM,
      stripPrice,
      tailPrice,
      linePrice,
      exceedsMaxRun,
    };
  }, [lengthMStr, tailMStr, qtyStr, product, perM]);

  // Exceeding the max continuous run is a advisory only — it means the
  // job needs joiners/separate runs, not that we refuse the sale. Trade
  // routinely buy 100m+ (Sally: "take off '5m max continuous run'").
  // A custom strip needs a name and a price per metre before it can be added.
  const customReady = !isCustom || (customName.trim() !== '' && perM > 0);
  const canAdd = calc.suppliedM > 0 && customReady;

  const subtotal = order.reduce((s, l) => s + l.linePrice, 0);

  const handleAdd = () => {
    if (!canAdd) return;
    setOrder((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        // Snapshot — a custom strip's fields can change for the next line.
        product: { ...product },
        lengthMm: calc.lengthMm,
        suppliedLengthM: calc.suppliedM,
        tailM: calc.tailM,
        qty: calc.qty,
        linePrice: calc.linePrice,
        perM,
        isTrade,
      },
    ]);
    setLengthMStr('');
    setQtyStr('1');
  };

  const handleRemove = (id: number) => {
    setOrder((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSend = () => {
    if (order.length === 0) return;
    const cartLines = order.map((l) => ({
      sku: `LED-STRIP-${l.product.id.toUpperCase()}-${Math.round(
        l.suppliedLengthM * 1000,
      )}`,
      name: `${l.product.name} — ${l.qty > 1 ? `${l.qty} × ` : ''}${formatLength(
        l.suppliedLengthM * 1000,
      )}${l.tailM > l.product.includedTailM ? ` + ${l.tailM}m tail` : ''}${
        l.isTrade ? ' (trade)' : ''
      }`,
      price: l.linePrice,
    }));
    onSendToCart(cartLines);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content bg-pos-bg text-pos-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-w-4xl mx-auto pb-10">
          {/* Header */}
          <div className="flex items-center justify-between py-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg bg-pos-accent text-amber-400 flex items-center justify-center">
                <ScissorsIcon className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xl font-bold text-pos-text">Strip Cut Counter</div>
                <div className="text-xs text-gray-400">
                  Staff order tool — cut-to-length LED strip
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsTrade((v) => !v)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  isTrade
                    ? 'bg-amber-500 text-gray-900 border-amber-500'
                    : 'bg-pos-card text-gray-300 border-gray-700 hover:border-gray-500'
                }`}
              >
                {isTrade ? 'Trade pricing' : 'Retail pricing'}
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-pos-text"
                aria-label="Close"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Product picker + cut calculator */}
          <div className="bg-pos-card rounded-xl border border-gray-700 p-5 mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-400">
                Product
              </label>
              {/* Visible switch — the custom option was easy to miss inside
                  the dropdown (Avi, 12 Oct 2026). */}
              <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    if (isCustom) setProductId(products[0]?.id ?? FALLBACK_STRIP_PRODUCTS[0].id);
                  }}
                  className={`px-3 py-1.5 ${!isCustom ? 'bg-amber-500 text-gray-900' : 'bg-pos-card text-gray-300 hover:text-pos-text'}`}
                >
                  From list
                </button>
                <button
                  type="button"
                  onClick={() => setProductId(CUSTOM_ID)}
                  className={`px-3 py-1.5 border-l border-gray-700 ${isCustom ? 'bg-amber-500 text-gray-900' : 'bg-pos-card text-gray-300 hover:text-pos-text'}`}
                >
                  + Custom strip
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="text"
                value={pickerOpen ? productQuery : isCustom ? 'Custom strip (typed in below)' : product.name}
                onFocus={() => {
                  setPickerOpen(true);
                  setProductQuery('');
                }}
                onChange={(e) => {
                  setProductQuery(e.target.value);
                  setPickerOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredProducts.length > 0) {
                    setProductId(filteredProducts[0].id);
                    setPickerOpen(false);
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    setPickerOpen(false);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                placeholder={`Search ${products.length} strips — name or SKU`}
                className="w-full border border-gray-700 bg-pos-bg rounded-md px-3 py-2 text-sm text-pos-text placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {pickerOpen && (
                <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-pos-card border border-gray-700 rounded-md shadow-xl">
                  <li>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setProductId(CUSTOM_ID);
                        setPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 border-b border-gray-700 hover:bg-pos-accent/40 ${
                        isCustom ? 'text-amber-400' : 'text-pos-text'
                      }`}
                    >
                      <span className="block text-sm font-semibold">+ Custom strip</span>
                      <span className="block text-[11px] text-gray-500">
                        Not in the list? Type in the name and price per metre
                      </span>
                    </button>
                  </li>
                  {filteredProducts.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">
                      No strips match “{productQuery}”
                    </li>
                  ) : (
                    filteredProducts.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          // preventDefault stops the input's blur firing
                          // before this click lands.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setProductId(p.id);
                            setPickerOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-pos-accent/40 ${
                            p.id === productId ? 'text-amber-400' : 'text-pos-text'
                          }`}
                        >
                          <span className="block text-sm">{p.name}</span>
                          <span className="block text-[11px] text-gray-500">
                            {p.id} · ${p.retailPerM.toFixed(2)}/m retail
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>

            {isCustom && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 border border-amber-500/40 rounded-lg p-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Strip name / description *</label>
                  <input
                    className="input py-1.5 text-sm"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. 14.4W 24V IP65 LED strip 4000K"
                    autoFocus
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">SKU (optional)</label>
                  <input
                    className="input py-1.5 text-sm font-mono"
                    value={customSku}
                    onChange={(e) => setCustomSku(e.target.value)}
                    placeholder="supplier code"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Retail $/m *</label>
                  <input
                    className="input py-1.5 text-sm"
                    inputMode="decimal"
                    value={customRetail}
                    onChange={(e) => setCustomRetail(e.target.value)}
                    placeholder="inc GST"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Trade $/m</label>
                  <input
                    className="input py-1.5 text-sm"
                    inputMode="decimal"
                    value={customTrade}
                    onChange={(e) => setCustomTrade(e.target.value)}
                    placeholder="blank = retail"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Cut points</label>
                  <select
                    className="input py-1.5 text-sm"
                    value={customCutMm}
                    onChange={(e) => setCustomCutMm(Number(e.target.value))}
                  >
                    {CUT_OPTIONS.map((o) => (
                      <option key={o.mm} value={o.mm}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Tail included (m)</label>
                  <input
                    className="input py-1.5 text-sm"
                    inputMode="decimal"
                    value={customTailIncl}
                    onChange={(e) => setCustomTailIncl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Extra tail $/m</label>
                  <input
                    className="input py-1.5 text-sm"
                    inputMode="decimal"
                    value={customTailPerM}
                    onChange={(e) => setCustomTailPerM(e.target.value)}
                  />
                </div>
                {!customReady && (
                  <p className="col-span-2 md:col-span-4 text-xs text-amber-500">
                    Enter the strip name and its price per metre to add it.
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-400">
              <span>Rate <span className="font-bold text-pos-text">${perM.toFixed(2)}</span>/m</span>
              <span>
                {product.cutMm <= 1 ? (
                  'Cut to exact length'
                ) : (
                  <>Cuts every <span className="font-bold text-pos-text">{formatLength(product.cutMm)}</span></>
                )}
              </span>
              <span>Max run <span className="font-bold text-pos-text">{product.maxRunM}m</span></span>
              <span>
                Tail <span className="font-bold text-pos-text">{product.includedTailM}m</span> incl
                {' · '}
                <span className="font-bold text-pos-text">+${product.tailPerM.toFixed(2)}</span>/m
              </span>
            </div>

            {/* Length + Qty + Tail inputs (reel bar removed — Sally, 7 Sep) */}
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Length (m)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  className="w-full border border-gray-700 bg-pos-bg rounded-md px-3 py-2 text-sm text-pos-text placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={lengthMStr}
                  onChange={(e) => setLengthMStr(e.target.value)}
                  placeholder="e.g. 3.2"
                  autoFocus
                />
                {calc.lengthMm > 0 && product.cutMm > 1 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Rounded up to next cut point → supplied{' '}
                    <span className="text-gray-300 font-semibold">
                      {formatLength(calc.suppliedMm)}
                    </span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Qty
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  className="w-full border border-gray-700 bg-pos-bg rounded-md px-3 py-2 text-sm text-pos-text focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={qtyStr}
                  onChange={(e) => setQtyStr(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  identical strips, e.g. 4 × 1m
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Tail length (m)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  className="w-full border border-gray-700 bg-pos-bg rounded-md px-3 py-2 text-sm text-pos-text focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={tailMStr}
                  onChange={(e) => setTailMStr(e.target.value)}
                  min={0}
                  step={0.5}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {product.includedTailM}m included · 0.5m steps
                </p>
              </div>
            </div>

            {/* Max-run advisory — informational, never blocks the sale */}
            {calc.exceedsMaxRun && (
              <div className="mt-4 border border-amber-500/40 bg-amber-500/10 text-amber-300 rounded-md px-3 py-2 text-sm">
                Heads up: {formatLength(calc.suppliedMm)} is over the{' '}
                {product.maxRunM}m max continuous run, so this will need
                joiners or separate runs. You can still add it.
              </div>
            )}

            {/* Line price + Add */}
            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Line price
                </div>
                <div className="text-3xl font-extrabold text-amber-400 leading-tight">
                  {money(calc.linePrice)}
                </div>
                <div className="text-xs text-gray-500">
                  {money(calc.stripPrice)} strip
                  {calc.tailPrice > 0
                    ? ` + ${money(calc.tailPrice)} tail`
                    : ''}
                </div>
              </div>
              <button
                onClick={handleAdd}
                disabled={!canAdd}
                className={`px-5 py-3 rounded-lg text-sm font-semibold flex items-center gap-2 ${
                  canAdd
                    ? 'bg-primary-600 text-white hover:bg-primary-500'
                    : 'bg-pos-accent/60 text-gray-500 cursor-not-allowed'
                }`}
              >
                + Add to order
              </button>
            </div>
          </div>

          {/* Order list */}
          <div className="bg-pos-card rounded-xl border border-gray-700 p-5">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardDocumentIcon className="h-5 w-5 text-gray-400" />
              <div className="font-bold text-pos-text">Order</div>
              <div className="text-xs text-gray-500">({order.length} lines)</div>
            </div>

            {order.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                Add a cut length and it lands here. Keep adding — you stay on this product.
              </div>
            ) : (
              <ul className="divide-y divide-gray-800">
                {order.map((l) => (
                  <li key={l.id} className="py-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-pos-text">
                        {l.product.name}
                      </div>
                      <div className="text-xs text-gray-400">
                        {l.qty > 1 ? `${l.qty} × ` : ''}
                        {formatLength(l.suppliedLengthM * 1000)} · tail {l.tailM}m · ${l.perM.toFixed(2)}/m
                        {l.isTrade ? ' · trade' : ''}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-pos-text">
                      {money(l.linePrice)}
                    </div>
                    <button
                      onClick={() => handleRemove(l.id)}
                      className="text-gray-500 hover:text-red-400 text-xs"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-gray-800 mt-4 pt-4">
              <div className="text-sm text-gray-400">Subtotal</div>
              <div className="text-lg font-bold text-amber-400 flex items-center gap-1">
                <BoltIcon className="h-5 w-5" />
                {money(subtotal)}
              </div>
            </div>

            <button
              onClick={handleSend}
              disabled={order.length === 0}
              className={`mt-4 w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${
                order.length === 0
                  ? 'bg-pos-accent/40 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-500'
              }`}
            >
              <PaperAirplaneIcon className="h-5 w-5" />
              Send to cart / My Quote
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
