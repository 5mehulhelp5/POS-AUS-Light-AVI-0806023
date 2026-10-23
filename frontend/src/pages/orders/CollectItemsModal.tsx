import { useState } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ordersApi } from '../../services/api';

// Customer takes some of what's still owed on an order — part of a back
// order or lay-by (Sally, 23 Oct 2026: POS-0342 ordered 18 of each, took 2
// and "draws down" 2 more each week; POS-0340 wanted 1 of its 2 fans).
// Kept apart from Edit Items and the per-line status menus so neither gets
// cluttered. The server splits each line; prices and the total don't move.

interface Props {
  order: any;
  onClose: () => void;
  onSaved: () => void;
}

export const isOpenLine = (it: any) =>
  (!!it.isBackorder && !it.backorderFulfilledAt) || !!it.isLaybyHeld;

export default function CollectItemsModal({ order, onClose, onSaved }: Props) {
  const lines: any[] = (order.items || []).filter(isOpenLine);
  // Blank = not taking any of that line today.
  const [qty, setQty] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const taking = lines
    .map((l) => ({ itemId: l.id, qty: Math.floor(Number(qty[l.id]) || 0), max: Number(l.quantity), name: l.name }))
    .filter((l) => l.qty > 0);
  const tooMany = taking.find((l) => l.qty > l.max);
  const units = taking.reduce((s, l) => s + l.qty, 0);

  const handleSave = async () => {
    if (!taking.length || tooMany) return;
    setSaving(true);
    try {
      await ordersApi.collectItems(
        order.id,
        taking.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      );
      toast.success(`${units} item${units === 1 ? '' : 's'} collected on ${order.orderNumber}`);
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop-top">
      <div className="modal-content">
        <div className="max-w-3xl mx-auto pb-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h2 className="text-xl font-bold text-pos-text">Collect Items</h2>
              <p className="text-xs text-gray-400">
                {order.orderNumber} · what is the customer taking today?
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              className="text-gray-400 hover:text-pos-text"
              aria-label="Close"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="bg-pos-card border border-gray-700 rounded-xl p-4">
            {lines.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing left to collect on this order.</p>
            ) : (
              <table className="w-full text-sm text-pos-text">
                <thead className="text-xs text-gray-400 uppercase">
                  <tr>
                    <th className="text-left py-2">Item</th>
                    <th className="text-center py-2 w-28">Still to collect</th>
                    <th className="text-center py-2 w-40">Taking now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {lines.map((l) => {
                    const v = qty[l.id] ?? '';
                    const over = Number(v) > Number(l.quantity);
                    return (
                      <tr key={l.id}>
                        <td className="py-2 pr-2">
                          <div>{l.name}</div>
                          <div className="text-xs text-gray-500">
                            {l.sku}
                            {l.isLaybyHeld ? (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-300 text-[10px] font-semibold uppercase">
                                Lay-by
                              </span>
                            ) : (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-cyan-600/30 text-cyan-300 text-[10px] font-semibold uppercase">
                                Back Order
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-center font-medium">{l.quantity}</td>
                        <td className="py-2">
                          <div className="flex items-center justify-center gap-2">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={l.quantity}
                              step={1}
                              placeholder="0"
                              className={`w-20 bg-pos-bg border rounded px-2 py-1 text-center text-pos-text ${
                                over ? 'border-red-500' : 'border-gray-700'
                              }`}
                              value={v}
                              disabled={saving}
                              onChange={(e) => setQty((m) => ({ ...m, [l.id]: e.target.value }))}
                            />
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={saving}
                              title="Taking all of this line"
                              onClick={() => setQty((m) => ({ ...m, [l.id]: String(l.quantity) }))}
                            >
                              All
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {tooMany && (
              <p className="mt-3 text-xs text-red-400">
                Only {tooMany.max}× {tooMany.name} left to collect.
              </p>
            )}
            <p className="mt-3 text-xs text-gray-500">
              The rest stays on back order / lay-by. Prices and the order total don&apos;t
              change — take any payment on the order screen as usual.
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} disabled={saving} className="btn bg-gray-700 text-pos-text">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !taking.length || !!tooMany}
              className="btn bg-primary-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : units ? `Collect ${units} item${units === 1 ? '' : 's'}` : 'Collect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
