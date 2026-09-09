import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  XMarkIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { ordersApi, productsApi } from '../../services/api';

// Edit the line items on an open order — used when the cashier needs
// to add products to a backorder, fix a qty, or override a price.
// Server rewrites the whole item set + re-totals + recomputes payment
// status. Blocked server-side when the order is already
// complete/refunded/cancelled.

interface Row {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  isBackorder: boolean;
  isCustom: boolean;
}

interface Props {
  order: any;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditOrderItemsModal({ order, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    (order.items || []).map((it: any) => ({
      productId: it.productId ?? -Date.now(),
      sku: it.sku,
      name: it.name,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      discountPercent: Number(it.discountPercent) || 0,
      isBackorder: !!it.isBackorder && !it.backorderFulfilledAt,
      isCustom: it.productId == null,
    })),
  );
  const [saving, setSaving] = useState(false);

  // Product search for the "add" panel
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!showAddSearch || search.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      productsApi
        .getProducts({ search: search.trim(), limit: 12, inStock: false })
        .then((r) => setSearchResults(r.data?.data?.products || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [showAddSearch, search]);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const addProduct = (p: any) => {
    if (rows.some((r) => r.productId === p.id)) {
      toast.error('Already in this order — edit the quantity above');
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        quantity: 1,
        unitPrice: Number(p.price),
        discountPercent: 0,
        isBackorder: false,
        isCustom: false,
      },
    ]);
    setSearch('');
    setSearchResults([]);
    setShowAddSearch(false);
  };

  const rowLineTotal = (r: Row) =>
    Math.round(r.quantity * r.unitPrice * (1 - r.discountPercent / 100) * 100) /
    100;
  const subtotal = rows.reduce((s, r) => s + rowLineTotal(r), 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const grandTotal = Math.round((subtotal + deliveryFee) * 100) / 100;

  const handleSave = async () => {
    if (rows.length === 0) {
      toast.error('Order must have at least one item');
      return;
    }
    setSaving(true);
    try {
      await ordersApi.updateItems(
        order.id,
        rows.map((r) => ({
          productId: r.productId,
          quantity: r.quantity,
          discountPercent: r.discountPercent,
          unitPrice: r.isBackorder || r.isCustom ? r.unitPrice : undefined,
          isBackorder: r.isBackorder,
          isCustom: r.isCustom,
          sku: r.isCustom ? r.sku : undefined,
          name: r.isCustom ? r.name : undefined,
        })),
      );
      toast.success('Order updated');
      onSaved();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || err?.message || 'Failed to update order',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop-top">
      <div className="modal-content">
        <div className="max-w-4xl mx-auto pb-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h2 className="text-xl font-bold text-pos-text">Edit Order Items</h2>
              <p className="text-xs text-gray-400">
                {order.orderNumber} · status {order.status}
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              className="text-gray-400 hover:text-pos-text"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="bg-pos-card border border-gray-700 rounded-xl p-4">
            <table className="w-full text-sm text-pos-text">
              <thead className="text-xs text-gray-400 uppercase">
                <tr>
                  <th className="text-left py-2">Item</th>
                  <th className="text-center py-2 w-20">Qty</th>
                  <th className="text-right py-2 w-24">Unit</th>
                  <th className="text-center py-2 w-20">Disc %</th>
                  <th className="text-right py-2 w-24">Line</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-2">
                      <div className="text-sm">{r.name}</div>
                      <div className="text-xs text-gray-500">
                        {r.sku}
                        {r.isBackorder && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-cyan-600/30 text-cyan-300 text-[10px] font-semibold uppercase">
                            Backorder
                          </span>
                        )}
                        {r.isCustom && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-300 text-[10px] font-semibold uppercase">
                            Custom
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="number"
                        min={1}
                        className="w-16 bg-pos-bg border border-gray-700 rounded px-2 py-1 text-center text-pos-text"
                        value={r.quantity}
                        onChange={(e) =>
                          updateRow(i, {
                            quantity: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        className="w-20 bg-pos-bg border border-gray-700 rounded px-2 py-1 text-right text-pos-text disabled:opacity-40"
                        value={r.unitPrice}
                        disabled={!r.isBackorder && !r.isCustom}
                        onChange={(e) =>
                          updateRow(i, {
                            unitPrice: Math.max(0, parseFloat(e.target.value) || 0),
                          })
                        }
                        title={
                          !r.isBackorder && !r.isCustom
                            ? 'Catalogue items sell at DB price. Use Disc % to adjust.'
                            : undefined
                        }
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="w-14 bg-pos-bg border border-gray-700 rounded px-2 py-1 text-center text-pos-text"
                        value={r.discountPercent}
                        onChange={(e) =>
                          updateRow(i, {
                            discountPercent: Math.max(
                              0,
                              Math.min(100, parseFloat(e.target.value) || 0),
                            ),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 text-right font-semibold">
                      ${rowLineTotal(r).toFixed(2)}
                    </td>
                    <td className="py-2 text-center">
                      <button
                        onClick={() => removeRow(i)}
                        className="text-gray-500 hover:text-red-400"
                        title="Remove line"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Add product panel */}
            <div className="mt-4 pt-4 border-t border-gray-800">
              {!showAddSearch ? (
                <button
                  onClick={() => setShowAddSearch(true)}
                  className="btn bg-primary-600 text-white flex items-center gap-2"
                >
                  <PlusIcon className="h-5 w-5" /> Add product
                </button>
              ) : (
                <div>
                  <div className="relative">
                    <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      autoFocus
                      className="w-full bg-pos-bg border border-gray-700 rounded-lg pl-10 pr-3 py-2 text-sm text-pos-text"
                      placeholder="Search product name, SKU, or barcode…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {searching && (
                    <p className="text-xs text-gray-500 mt-2">Searching…</p>
                  )}
                  {searchResults.length > 0 && (
                    <div className="mt-2 max-h-64 overflow-y-auto bg-pos-bg border border-gray-700 rounded">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addProduct(p)}
                          className="w-full text-left px-3 py-2 hover:bg-pos-accent border-b border-gray-800 last:border-b-0"
                        >
                          <div className="text-sm text-pos-text">{p.name}</div>
                          <div className="text-xs text-gray-500">
                            {p.sku} · ${Number(p.price).toFixed(2)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setShowAddSearch(false);
                      setSearch('');
                      setSearchResults([]);
                    }}
                    className="text-xs text-gray-500 hover:text-pos-text mt-2"
                  >
                    Cancel search
                  </button>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="mt-4 pt-4 border-t border-gray-800 flex justify-end">
              <div className="w-64 text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between">
                    <span>Delivery</span>
                    <span>${deliveryFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-pos-text text-base pt-1 border-t border-gray-800">
                  <span>Total</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              disabled={saving}
              className="btn bg-gray-700 text-pos-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || rows.length === 0}
              className="btn bg-primary-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
