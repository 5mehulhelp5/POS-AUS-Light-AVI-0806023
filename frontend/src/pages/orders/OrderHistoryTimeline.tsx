// Order History timeline (Sally, 9 Sep: "create a history section to
// show what actions have happened to the order"). One merged, newest-
// first feed of everything that ever happened to an order:
//   - payments (deposit + balance instalments, with method)
//   - refunds (items returned, cash vs credit, restock fee)
//   - exchanges (both directions, with the swapped items)
//   - backorder items received (per-item fulfilledAt)
//   - item edits from Add Lights / Edit Items (order_events rows)
//   - the original sale at the bottom
// Shared by the Order Detail modal and the Refund/Edit modal — Sally
// opens orders through the latter, so the history must live there too.

const REFUND_REASON_LABELS: Record<string, string> = {
  damaged: 'Damaged',
  faulty_product: 'Faulty Product',
  wrong_item: 'Wrong Item',
  customer_changed_mind: 'Customer Changed Mind',
  pricing_error: 'Pricing Error',
  other: 'Other',
};

const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const methodLabel = (m: string) =>
  m === 'eftpos'
    ? 'EFTPOS'
    : m === 'bank_transfer'
      ? 'Bank Transfer'
      : m === 'store_credit'
        ? 'Store Credit'
        : m === 'credit_card'
          ? 'Credit Card'
          : m.charAt(0).toUpperCase() + m.slice(1);

interface TimelineEntry {
  key: string;
  date: string;
  node: JSX.Element;
}

export default function OrderHistoryTimeline({
  order,
  refunds,
}: {
  order: any;
  refunds: any[];
}) {
  const entries: TimelineEntry[] = [];

  // --- Payments (skip pure store-credit consumption? no — show all,
  // staff want the full money trail). First payment on a deposit-type
  // order reads "Deposit", later ones "Payment".
  const payments = [...(order.payments || [])].sort(
    (a: any, b: any) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const isDepositOrder =
    order.orderType === 'layby' ||
    (order.items || []).some((i: any) => i.isBackorder || i.isLaybyHeld);
  payments.forEach((p: any, idx: number) => {
    const label =
      isDepositOrder && idx === 0
        ? 'Deposit'
        : isDepositOrder
          ? 'Balance payment'
          : 'Payment';
    entries.push({
      key: `pay-${p.id}`,
      date: p.createdAt,
      node: (
        <div className="bg-green-500/10 border border-green-500/30 rounded p-3 text-sm">
          <div className="flex justify-between">
            <span className="font-medium text-green-300">
              {label} — ${Number(p.amount).toFixed(2)} ({methodLabel(p.method)})
            </span>
            <span className="text-gray-400">{formatDate(p.createdAt)}</span>
          </div>
          {p.reference && (
            <div className="text-xs text-gray-500 mt-1">Ref: {p.reference}</div>
          )}
        </div>
      ),
    });
  });

  // --- Refunds (with items, cash/credit tag, restock fee)
  for (const r of refunds || []) {
    const tags: string[] = [];
    const isCash = /\[CASH REFUND\]/i.test(r.reasonText || '');
    tags.push(isCash ? 'Cash refund' : 'Store credit');
    const restockMatch = (r.reasonText || '').match(
      /\[20% RESTOCK FEE: \$([\d.]+) retained\]/i,
    );
    if (restockMatch) tags.push(`20% restock fee $${restockMatch[1]} kept`);
    const cleanReason = (r.reasonText || '').replace(/\[[^\]]*\]/g, '').trim();
    entries.push({
      key: `refund-${r.id}`,
      date: r.createdAt,
      node: (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3 text-sm">
          <div className="flex justify-between mb-1">
            <span className="font-medium text-orange-300">
              {r.isFullRefund ? 'Full Refund' : 'Partial Refund'} — $
              {Number(r.refundAmount).toFixed(2)}
            </span>
            <span className="text-gray-400">{formatDate(r.createdAt)}</span>
          </div>
          <div className="flex flex-wrap gap-1 mb-1">
            {tags.map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-600/30 text-orange-200"
              >
                {t}
              </span>
            ))}
          </div>
          {(r.items || []).length > 0 && (
            <ul className="mb-2 mt-1 space-y-0.5">
              {r.items.map((ri: any) => (
                <li
                  key={ri.id}
                  className="flex justify-between text-xs text-gray-300"
                >
                  <span>
                    {ri.quantity}
                    {ri.originalQuantity ? ` of ${ri.originalQuantity}` : ''} ×{' '}
                    {ri.name || `Item #${ri.orderItemId}`}
                    {ri.sku ? (
                      <span className="text-gray-500 font-mono"> {ri.sku}</span>
                    ) : null}
                    {ri.restock ? (
                      <span className="text-gray-500"> · restocked</span>
                    ) : null}
                  </span>
                  <span className="font-medium">
                    ${Number(ri.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-xs text-gray-400">
            Reason: {REFUND_REASON_LABELS[r.reason] || r.reason}
            {cleanReason ? ` — "${cleanReason}"` : ''}
          </div>
          {r.user && (
            <div className="text-xs text-gray-500 mt-1">
              Processed by {r.user.firstName} {r.user.lastName}
            </div>
          )}
        </div>
      ),
    });
  }

  // --- Exchange cross-links
  for (const e of order.exchangedToOrders || []) {
    entries.push({
      key: `ex-to-${e.id}`,
      // Replacement orders don't carry a createdAt in the link payload —
      // pin them to the top by using "now" as a sort key fallback.
      date: e.createdAt || new Date().toISOString(),
      node: (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm text-cyan-200">
          <div className="font-semibold mb-1">Exchanged for {e.orderNumber}</div>
          {e.items && e.items.length > 0 && (
            <ul className="text-xs space-y-0.5 text-cyan-100">
              {e.items.map((it: any) => (
                <li key={it.id}>
                  {it.quantity}× {it.name}
                  <span className="text-cyan-300/70">
                    {' '}
                    · {it.sku} · ${Number(it.unitPrice).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    });
  }
  if (order.exchangeFromOrder) {
    entries.push({
      key: 'ex-from',
      date: order.createdAt,
      node: (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm text-cyan-200">
          <div className="font-semibold mb-1">
            Replacement for {order.exchangeFromOrder.orderNumber}
          </div>
          {order.exchangeFromOrder.items &&
            order.exchangeFromOrder.items.length > 0 && (
              <>
                <div className="text-xs mb-1 text-cyan-300/80">Returned:</div>
                <ul className="text-xs space-y-0.5 text-cyan-100">
                  {order.exchangeFromOrder.items.map((it: any) => (
                    <li key={it.id}>
                      {it.quantity}× {it.name}
                      <span className="text-cyan-300/70">
                        {' '}
                        · {it.sku} · ${Number(it.unitPrice).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </div>
      ),
    });
  }

  // --- Backorder items received (derived from per-item fulfilledAt)
  for (const it of order.items || []) {
    if (it.isBackorder && it.backorderFulfilledAt) {
      entries.push({
        key: `fulfil-${it.id}`,
        date: it.backorderFulfilledAt,
        node: (
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-3 text-sm">
            <div className="flex justify-between">
              <span className="font-medium text-cyan-300">
                Backorder received — {it.quantity}× {it.name}
              </span>
              <span className="text-gray-400">
                {formatDate(it.backorderFulfilledAt)}
              </span>
            </div>
          </div>
        ),
      });
    }
  }

  // --- Item edits (order_events)
  for (const ev of order.events || []) {
    entries.push({
      key: `ev-${ev.id}`,
      date: ev.createdAt,
      node: (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-purple-200">{ev.description}</span>
            <span className="text-gray-400 whitespace-nowrap">
              {formatDate(ev.createdAt)}
            </span>
          </div>
        </div>
      ),
    });
  }

  entries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const dotColor: Record<string, string> = {
    pay: 'bg-green-400',
    refund: 'bg-orange-400',
    ex: 'bg-cyan-400',
    fulfil: 'bg-cyan-400',
    ev: 'bg-purple-400',
  };

  return (
    <div>
      <p className="text-sm text-gray-400 mb-3">Order History</p>
      <div className="relative pl-5 space-y-3">
        <div className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-700" />
        {entries.map((e) => (
          <div key={e.key} className="relative">
            <div
              className={`absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-pos-card ${
                dotColor[e.key.split('-')[0]] || 'bg-gray-400'
              }`}
            />
            {e.node}
          </div>
        ))}

        {/* The original sale — always last */}
        <div className="relative">
          <div className="absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-pos-card" />
          <div className="bg-pos-accent/40 rounded p-3 text-sm">
            <div className="flex justify-between">
              <span className="font-medium text-green-300">
                Order placed — ${parseFloat(order.grandTotal).toFixed(2)}
              </span>
              <span className="text-gray-400">{formatDate(order.createdAt)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {order.user
                ? `By ${order.user.firstName} ${order.user.lastName || ''}`
                : ''}
              {order.customer
                ? ` · ${order.customer.firstName} ${order.customer.lastName || ''}`
                : ' · Walk-in'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
