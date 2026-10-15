import { useRef, useState, CSSProperties } from 'react';
import {
  XMarkIcon,
  PrinterIcon,
  ArrowDownTrayIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { CartItem } from '../../../store/slices/cartSlice';
import { formatPhone } from '../../../utils/phone';

// Company block printed at the top + footer of every invoice. Matches the
// legal Australian Lighting & Fans (Sunridge) tax-invoice template.
const COMPANY = {
  brandLight: 'AUSTRALIAN',
  brandAccent: 'LIGHTING',
  legalName: 'SUNRIDGE AUSTRALIA T/A AUSTRALIAN LIGHTING & FANS CLAYTON',
  abn: '24 068 282 959',
  phone: '(03) 9548 9200',
  email: 'info@australianlighting.com.au',
  address: '1704 Princes Hwy, Oakleigh East VIC 3166',
  payeeName: 'Sunridge Australian Pty Ltd',
  bsb: '123-621',
  account: '21502941',
};

// Invoice is fully monochrome per client request — the wordmark, date,
// and balance all render in INK. ORANGE is kept as an alias pointing to
// INK so any downstream use resolves to black without renaming every
// call site.
const INK = '#111827';
const ORANGE = INK;
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

interface InvoiceData {
  orderNumber: string;
  date: string;
  updatedAt?: string;
  buyerType: 'retail' | 'customer';
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  companyAbn?: string;
  items: (CartItem & {
    isBackorder?: boolean;
    isLaybyHeld?: boolean;
    // Units of this line refunded so far — set on re-prints via
    // buildInvoiceData(order, ..., refunds).
    refundedQty?: number;
    // Part of the line on backorder / lay-by (the rest is taken today).
    // Missing = the whole line, which is how re-printed orders arrive
    // (the server stores a split line as separate items).
    backorderQty?: number;
    laybyHeldQty?: number;
  })[];
  subtotal: number;
  itemDiscounts: number;
  cartDiscount: number;
  taxAmount: number;
  grandTotal: number;
  // Delivery fee that's baked into grandTotal. Rendered as a separate
  // "DELIVERY" line in the totals block when > 0 so the customer sees
  // the freight charge itemised.
  deliveryFee?: number;
  deliveryType?: string;
  paymentMethod: string;
  cashTendered?: number;
  change?: number;
  isLayby?: boolean;
  isBackorder?: boolean;
  isMixed?: boolean;
  amountPaid?: number;
  balanceDue?: number;
  // Individual money-in events (deposit + balance instalments). When
  // there's more than one, each prints as its own line with method and
  // date instead of the single DEPOSIT/PAID row.
  payments?: { method: string; amount: number; date?: string }[];
  takeNowSubtotal?: number;
  deferredSubtotal?: number;
  salesPerson?: string;
  notes?: string;
  // Exchange metadata — set when this sale replaces goods returned on
  // an earlier order. creditApplied is the store credit consumed by
  // this sale; refundDueToCustomer is what's left over when the return
  // was worth MORE than the replacement and has to be paid back.
  exchangeFromOrderNumber?: string;
  creditApplied?: number;
  refundDueToCustomer?: number;
  // Total refunded on this order to date (re-prints after a refund).
  totalRefunded?: number;
}

interface InvoiceModalProps {
  invoice: InvoiceData;
  onClose: () => void;
}

const formatDate = (s?: string) =>
  s
    ? new Date(s).toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

const money = (n: number) =>
  `$${(n || 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Split the comma-joined address into two visual lines: the first is the
// street, the rest collapses into a single suburb/state/postcode line.
function splitAddress(addr?: string): { line1: string; line2: string } {
  if (!addr) return { line1: '', line2: '' };
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { line1: parts[0] || '', line2: '' };
  return { line1: parts[0], line2: parts.slice(1).join(' ') };
}

export default function InvoiceModal({ invoice, onClose }: InvoiceModalProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printContent = invoiceRef.current;
    if (!printContent) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${invoice.orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
              color: ${INK};
              padding: 24px;
            }
            .invoice-container { max-width: 820px; margin: 0 auto; }
            @page { size: A4; margin: 14mm; }
            @media print {
              body { padding: 0; }
              .no-print { display: none !important; }
            }
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const pdfName = `Invoice-${invoice.orderNumber}.pdf`;
  const pdfOptions = {
    margin: 10,
    filename: pdfName,
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    html2canvas: { scale: 2, useCORS: true },
  };

  const handleSavePdf = async () => {
    const node = invoiceRef.current;
    if (!node) return;
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf().set(pdfOptions).from(node).save();
  };

  // The same PDF, kept in memory to go inside the email.
  const buildPdfBlob = async (): Promise<Blob> => {
    const node = invoiceRef.current;
    if (!node) throw new Error('Invoice not ready');
    const html2pdf = (await import('html2pdf.js')).default;
    return (await html2pdf().set(pdfOptions).from(node).outputPdf('blob')) as Blob;
  };

  // Email the invoice with the PDF attached (Sally, 12 Oct 2026: "Can
  // there be a PDF file attached ... at the moment it's all text"). A
  // browser can't attach a file to a mailto link, so the POS builds the
  // whole email itself — customer's address, subject, Sally's message
  // (16 Sep template) and the invoice PDF — as an unsent Outlook draft
  // (.eml with "X-Unsent: 1") and downloads it. Opening it from Chrome's
  // downloads opens Outlook's New Email window with everything in place,
  // sent from that computer's Outlook account. No server-side mail.
  const [emailBusy, setEmailBusy] = useState(false);
  const handleEmail = async () => {
    if (emailBusy) return;
    const to = (invoice.customerEmail || '').trim();
    const customerName = (invoice.customerName || '').trim();
    const subject = `Invoice #${invoice.orderNumber} — Australian Lighting`;
    // Sally's template (16 Sep 2026). Amount Due / Due Date follow the
    // balance: a fully paid sale says so rather than re-billing the
    // total; a deposit sale shows what's still owing.
    const owing =
      typeof invoice.balanceDue === 'number' && invoice.balanceDue > 0.01
        ? invoice.balanceDue
        : 0;
    const amountDue = owing > 0 ? money(owing) : `${money(0)} (paid in full)`;
    const dueDate = owing > 0 ? 'On collection of goods' : 'Paid in full';
    const body =
      `Hi${customerName ? ` ${customerName}` : ''},\n\n` +
      `Thank you for your business! This email confirms that invoice #${invoice.orderNumber} for ` +
      `${money(invoice.grandTotal)} has been generated and is attached for your records.\n\n` +
      `Invoice details:\n` +
      `- Invoice Number: ${invoice.orderNumber}\n` +
      `- Issue Date: ${formatDate(invoice.date)}\n` +
      `- Due Date: ${dueDate}\n` +
      `- Amount Due: ${amountDue}\n\n` +
      `If you have any questions about this invoice or need any adjustments, simply reply to email ` +
      `info@australianlighting.com.au or contact us on 03 9548 9200 (option 1)\n\n` +
      `Thank you for choosing\nAustralian Lighting\n\n` +
      `1704 Dandenong Rd\nOakleigh East Vic 3166\n03 9548 9200\n`;
    const addresses = to.split(/[,;\s]+/).filter(Boolean);

    setEmailBusy(true);
    try {
      const pdf = await buildPdfBlob();
      const eml = buildEml({
        to: addresses,
        subject,
        body,
        attachment: { name: pdfName, type: 'application/pdf', base64: await blobToBase64(pdf) },
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
      a.download = `Invoice-${invoice.orderNumber}.eml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      // The AL POS app window has no downloads button, so say where the
      // file went (Sally, 13 Oct 2026: "what steps to get this to pop up").
      toast(
        `Email ready: Invoice-${invoice.orderNumber}.eml is in Downloads. Press Ctrl+J and click it ` +
          '(or open your Downloads folder). It opens in Outlook with the PDF attached. Check it and press Send.',
        { duration: 15000, icon: '📧' },
      );
    } catch {
      toast.error('Could not build the email — use Save PDF and attach it manually');
    } finally {
      setEmailBusy(false);
    }
  };

  const addr = splitAddress(invoice.customerAddress);
  const showDeposit =
    typeof invoice.balanceDue === 'number' && invoice.balanceDue > 0.01;
  const methodLabel = (m?: string) =>
    m === 'cash'
      ? 'CASH'
      : m === 'bank_transfer'
        ? 'BANK TRANSFER'
        : m === 'store_credit'
          ? 'STORE CREDIT'
          : 'EFTPOS';

  // Aggregate qty splits across the order so we can render per-line
  // TAKEN / B-ORDER / LAY-BY columns matching the printed template.
  const rows = invoice.items.map((it) => {
    const backQty = it.isBackorder
      ? Math.min(it.quantity, Math.max(0, it.backorderQty ?? it.quantity))
      : 0;
    const heldQty = it.isLaybyHeld
      ? Math.min(it.quantity - backQty, Math.max(0, it.laybyHeldQty ?? it.quantity))
      : 0;
    return {
    qty: it.quantity,
    name: it.name,
    sku: it.sku,
    // What the customer actually pays per unit (trade / promo / discount
    // already off), with the list price kept to show crossed out. Sally,
    // 12 Oct 2026: a trade invoice showed the $217.24 retail as the unit
    // price next to a $347.58 total for 2 ($173.79 trade each), and the
    // customer was charged for the wrong quantity.
    unitPrice: it.quantity > 0 ? it.rowTotal / it.quantity : it.unitPrice,
    listPrice: it.unitPrice,
    rowTotal: it.rowTotal,
    takenQty: it.quantity - backQty - heldQty,
    backorderQty: backQty,
    laybyQty: heldQty,
    // Flag clearance/sale lines so the printed invoice shows why the
    // price differs from the ticketed RRP.
    isSale: !!it.isSaleItem,
    refundedQty: it.refundedQty || 0,
    };
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="paper bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-800 text-pos-text p-4 flex items-center justify-between z-10 no-print">
          <h2 className="text-lg font-bold">Invoice Preview</h2>
          <div className="flex items-center gap-3">
            <button className="btn-sm bg-primary-600 text-white flex items-center gap-2" onClick={handlePrint}>
              <PrinterIcon className="h-4 w-4" /> Print
            </button>
            <button className="btn-sm bg-green-600 text-white flex items-center gap-2" onClick={handleSavePdf}>
              <ArrowDownTrayIcon className="h-4 w-4" /> Save PDF
            </button>
            <button
              className="btn-sm bg-blue-600 text-white flex items-center gap-2 disabled:opacity-60"
              onClick={handleEmail}
              disabled={emailBusy}
              title={
                invoice.customerEmail
                  ? `Creates an email to ${invoice.customerEmail} with the invoice PDF attached`
                  : 'Creates an email with the invoice PDF attached — type the customer address in Outlook'
              }
            >
              <EnvelopeIcon className="h-4 w-4" /> {emailBusy ? 'Preparing…' : 'Email'}
            </button>
            <button className="text-gray-400 hover:text-pos-text" onClick={onClose}>
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div
          ref={invoiceRef}
          className="invoice-container p-8"
          style={{
            color: INK,
            backgroundColor: '#fff',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '13px',
            lineHeight: 1.45,
          }}
        >
          {/* Header — brand wordmark left, TAX INVOICE block right */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '-0.5px' }}>
                <span style={{ color: INK }}>{COMPANY.brandLight} </span>
                <span style={{ color: ORANGE }}>{COMPANY.brandAccent}</span>
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: MUTED, letterSpacing: '0.3px' }}>
                {COMPANY.legalName}
              </div>
              <div style={{ fontSize: '11px', color: MUTED, marginTop: '2px' }}>
                ABN {COMPANY.abn}
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '220px' }}>
              <div style={{ fontSize: '11px', color: MUTED, letterSpacing: '1px' }}>TAX INVOICE</div>
              <div style={{ fontSize: '11px', color: MUTED, marginTop: '8px', letterSpacing: '1px' }}>INVOICE NO.</div>
              <div style={{ marginTop: '6px', border: `1px solid ${INK}`, padding: '10px 14px', fontSize: '22px', fontWeight: 800 }}>
                {invoice.orderNumber}
              </div>
            </div>
          </div>

          {/* Contact strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}`, fontSize: '12px', color: MUTED }}>
            <span>{COMPANY.phone}</span>
            <span style={{ flex: 1, textAlign: 'center' }}>{COMPANY.email}</span>
            <span>{COMPANY.address}</span>
          </div>

          {/* Bill To / Invoice meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '22px', gap: '40px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: MUTED, letterSpacing: '1px', marginBottom: '6px' }}>BILL TO</div>
              {invoice.customerName && (
                <div style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{invoice.customerName}</div>
              )}
              {invoice.customerCompany && (
                <div style={{ marginTop: '2px' }}>{invoice.customerCompany}</div>
              )}
              {(addr.line1 || addr.line2) && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Address</div>
                  {addr.line1 && <div>{addr.line1}</div>}
                  {addr.line2 && <div style={{ textTransform: 'uppercase' }}>{addr.line2}</div>}
                </>
              )}
              {invoice.customerPhone && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Phone</div>
                  <div>{formatPhone(invoice.customerPhone)}</div>
                </>
              )}
              {invoice.customerEmail && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Email</div>
                  <div>{invoice.customerEmail}</div>
                </>
              )}
            </div>

            <div style={{ width: '300px' }}>
              <div style={{ fontSize: '11px', color: MUTED, letterSpacing: '1px' }}>INVOICE DATE</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: ORANGE, marginTop: '2px' }}>
                {formatDate(invoice.date)}
              </div>
              <table style={{ marginTop: '14px', width: '100%', fontSize: '12px' }}>
                <tbody>
                  <tr>
                    <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Invoice Number:</td>
                    <td>{invoice.orderNumber}</td>
                  </tr>
                  {invoice.updatedAt && (
                    <tr>
                      <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Updated on:</td>
                      <td>{formatDate(invoice.updatedAt)}</td>
                    </tr>
                  )}
                  {invoice.salesPerson && (
                    <>
                      <tr>
                        <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Updated by:</td>
                        <td>{invoice.salesPerson}</td>
                      </tr>
                      <tr>
                        <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Lighting consultant:</td>
                        <td>{invoice.salesPerson}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Items table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}` }}>
                <th style={th('center', 56)}>QTY</th>
                <th style={th('left')}>PRODUCT DESCRIPTION</th>
                <th style={th('right', 90)}>UNIT PRICE*</th>
                <th style={th('center', 60)}>TAKEN</th>
                <th style={th('center', 70)}>B/ORDER</th>
                <th style={th('center', 70)}>LAY-BY</th>
                <th style={th('right', 100)}>TOTAL*</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${RULE}` }}>
                  <td style={td('center')}>{r.qty}</td>
                  <td style={td('left')}>
                    {r.name}
                    {r.sku ? (
                      <span style={{ color: MUTED, fontSize: '11px' }}> — {r.sku}</span>
                    ) : null}
                    {r.isSale ? (
                      <span
                        style={{
                          marginLeft: 6,
                          padding: '1px 5px',
                          border: `1px solid ${INK}`,
                          borderRadius: 3,
                          fontSize: '9px',
                          fontWeight: 800,
                          letterSpacing: '0.04em',
                          verticalAlign: 'middle',
                        }}
                      >
                        SALE
                      </span>
                    ) : null}
                    {r.refundedQty > 0 ? (
                      <span
                        style={{
                          marginLeft: 6,
                          padding: '1px 5px',
                          border: `1px solid ${ORANGE}`,
                          color: ORANGE,
                          borderRadius: 3,
                          fontSize: '9px',
                          fontWeight: 800,
                          letterSpacing: '0.04em',
                          verticalAlign: 'middle',
                        }}
                      >
                        REFUNDED{r.refundedQty < r.qty ? ` ${r.refundedQty} OF ${r.qty}` : ''}
                      </span>
                    ) : null}
                  </td>
                  <td style={td('right')}>
                    <span style={{ fontWeight: r.listPrice - r.unitPrice > 0.005 ? 700 : undefined }}>
                      {money(r.unitPrice)}
                    </span>
                    {r.listPrice - r.unitPrice > 0.005 ? (
                      <div style={{ color: MUTED, fontSize: '10px', textDecoration: 'line-through' }}>
                        {money(r.listPrice)}
                      </div>
                    ) : null}
                  </td>
                  <td style={td('center')}>{r.takenQty || ''}</td>
                  <td style={td('center')}>{r.backorderQty || ''}</td>
                  <td style={td('center')}>{r.laybyQty || ''}</td>
                  <td style={td('right')}>{money(r.rowTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals — right-aligned block */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <table style={{ width: '320px', fontSize: '13px' }}>
              <tbody>
                <tr>
                  <td style={totLabel}>SUBTOTAL</td>
                  <td style={totVal(true)}>{money(invoice.grandTotal)}</td>
                </tr>
                <tr>
                  <td style={totLabel}>GOODS TAKEN:</td>
                  <td style={totVal()}>
                    {invoice.takeNowSubtotal != null ? money(invoice.takeNowSubtotal) : ''}
                  </td>
                </tr>
                {/* Payment reflection (Sally, 7 Sep): money received
                    prints as DEPOSIT (partial) or PAID (in full) with
                    the method; an unpaid bank transfer gets its own
                    line so the remaining balance is explained. */}
                {invoice.payments && invoice.payments.length > 1 ? (
                  // Multiple money-in events (deposit + balance payment,
                  // Sally 9 Sep): each prints as its own dated line so
                  // the second payment is visible on a reprint.
                  invoice.payments.map((p, i) => (
                    <tr key={i}>
                      <td style={totLabel}>
                        {i === 0 && (showDeposit || invoice.isLayby || invoice.isBackorder)
                          ? 'DEPOSIT'
                          : 'PAYMENT'}{' '}
                        (
                        {methodLabel(p.method)}
                        {p.date
                          ? ` · ${new Date(p.date).toLocaleDateString('en-AU', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}`
                          : ''}
                        ):
                      </td>
                      <td style={totVal()}>{money(p.amount)}</td>
                    </tr>
                  ))
                ) : (
                  typeof invoice.amountPaid === 'number' &&
                  invoice.amountPaid > 0 && (
                    <tr>
                      <td style={totLabel}>
                        {showDeposit ? 'DEPOSIT' : 'PAID'} ({methodLabel(invoice.paymentMethod)}):
                      </td>
                      <td style={totVal()}>{money(invoice.amountPaid)}</td>
                    </tr>
                  )
                )}
                {invoice.paymentMethod === 'bank_transfer' && showDeposit && (
                  <tr>
                    <td style={totLabel} colSpan={2}>
                      PAYING BY BANK TRANSFER
                    </td>
                  </tr>
                )}
                {invoice.deliveryFee != null && invoice.deliveryFee > 0 && (
                  <tr>
                    <td style={totLabel}>
                      DELIVERY
                      {invoice.deliveryType && invoice.deliveryType !== 'delivery'
                        ? ` (${invoice.deliveryType.replace(/_/g, ' ')})`
                        : ''}
                      :
                    </td>
                    <td style={totVal()}>{money(invoice.deliveryFee)}</td>
                  </tr>
                )}
                <tr>
                  <td style={totLabel}>INCLUDES GST:</td>
                  <td style={totVal()}>{money(invoice.taxAmount)}</td>
                </tr>
                {/* Exchange: credit taken off this sale, and any cash
                    difference owed back when the returned goods were
                    worth more than the replacement. */}
                {invoice.exchangeFromOrderNumber && (
                  <tr>
                    <td style={totLabel}>EXCHANGE OF:</td>
                    <td style={totVal()}>{invoice.exchangeFromOrderNumber}</td>
                  </tr>
                )}
                {invoice.creditApplied != null && invoice.creditApplied > 0 && (
                  <tr>
                    <td style={totLabel}>CREDIT APPLIED:</td>
                    <td style={totVal()}>-{money(invoice.creditApplied)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ ...totLabel, fontWeight: 800, color: INK, paddingTop: '12px' }}>BALANCE:</td>
                  <td
                    style={{
                      ...totVal(true),
                      color: ORANGE,
                      paddingTop: '12px',
                      fontSize: '16px',
                    }}
                  >
                    {/* Store credit is money already paid — subtract it so
                        a credit-covered exchange prints BALANCE $0.00
                        instead of re-billing the replacement item.
                        When balanceDue is provided it is authoritative
                        (0 for paid-in-full — Sally, 7 Sep); only legacy
                        payloads without it fall back to the total. */}
                    {money(
                      Math.max(
                        0,
                        Math.round(
                          ((typeof invoice.balanceDue === 'number'
                            ? invoice.balanceDue
                            : invoice.grandTotal) -
                            (invoice.creditApplied || 0)) *
                            100,
                        ) / 100,
                      ),
                    )}
                  </td>
                </tr>
                {invoice.refundDueToCustomer != null &&
                  invoice.refundDueToCustomer > 0.01 && (
                    <tr>
                      <td
                        style={{ ...totLabel, fontWeight: 800, color: INK }}
                      >
                        REFUND DUE TO CUSTOMER:
                      </td>
                      <td
                        style={{
                          ...totVal(true),
                          color: ORANGE,
                          fontSize: '16px',
                        }}
                      >
                        -{money(invoice.refundDueToCustomer)}
                      </td>
                    </tr>
                  )}
                {/* Re-print after a refund: show what's come back and
                    the net position, so the invoice never reads like
                    the original untouched sale. */}
                {invoice.totalRefunded != null && invoice.totalRefunded > 0.01 && (
                  <>
                    <tr>
                      <td style={{ ...totLabel, color: ORANGE }}>
                        LESS REFUNDED:
                      </td>
                      <td style={{ ...totVal(), color: ORANGE }}>
                        -{money(invoice.totalRefunded)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ ...totLabel, fontWeight: 800, color: INK }}>
                        NET AFTER REFUND:
                      </td>
                      <td style={{ ...totVal(true), fontSize: '15px' }}>
                        {money(
                          Math.max(0, invoice.grandTotal - invoice.totalRefunded),
                        )}
                      </td>
                    </tr>
                  </>
                )}
                {invoice.cashTendered != null && (
                  <>
                    <tr>
                      <td style={totLabel}>Cash Tendered:</td>
                      <td style={totVal()}>{money(invoice.cashTendered)}</td>
                    </tr>
                    <tr>
                      <td style={totLabel}>Change:</td>
                      <td style={totVal()}>{money(invoice.change || 0)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* NOTES box */}
          <div style={{ marginTop: '22px', border: `1px solid ${RULE}`, padding: '12px', minHeight: '60px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: INK, letterSpacing: '0.5px' }}>NOTES:</div>
            {invoice.notes && (
              <div style={{ marginTop: '6px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{invoice.notes}</div>
            )}
          </div>

          {/* Legal / signature row */}
          <div style={{ display: 'flex', gap: '40px', marginTop: '22px', borderTop: `1px solid ${RULE}`, paddingTop: '14px', fontSize: '11px', color: MUTED }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: INK }}>*PRICES GST INCLUSIVE</div>
              <div style={{ marginTop: '14px' }}>Goods checked and received :</div>
              <div style={{ marginTop: '18px', borderBottom: `1px solid ${INK}`, height: '0' }} />
              <div style={{ marginTop: '14px', fontWeight: 800, color: INK }}>
                *RETURNS & REFUNDS ACCEPTED WITHIN 30 DAYS<br />OF PURCHASE ONLY*
              </div>
            </div>
            <div style={{ flex: 1.4 }}>
              <div style={{ fontWeight: 800, color: INK }}>CONDITIONS OF SALE:</div>
              <p style={{ marginTop: '4px' }}>
                NO EXCHANGE OR REFUND WITHOUT RECEIPT. NO REFUND FOR CHANGE OF MIND.
                RETURNS & REFUNDS ACCEPTED WITHIN 30 DAYS OF PURCHASE ONLY.
                GOODS PURCHASED OR MANUFACTURED TO ORDER ARE NOT RETURNABLE OR REFUNDABLE. DISCONTINUED,
                EX-DISPLAY, LED STRIP & CUSTOM MADE ITEMS CANNOT BE RETURNED OR EXCHANGED. ANY APPROVED RETURN
                SUBJECT TO A 20% RESTOCKING CHARGE.
                TITLE OF GOODS REMAIN PROPERTY OF AUSTRALIAN LIGHTING UNTIL PAID IN FULL. ANY STATED DELIVERY DATE
                MAY BE SUBJECT TO DELAYS BEYOND OUR CONTROL.
                QUOTES VALID 30 DAYS. CREDITS VALID 12 MONTHS.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '18px', borderTop: `1px solid ${RULE}`, paddingTop: '12px', fontSize: '11px', color: MUTED }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: INK }}>DIRECT ALL INQUIRIES TO:</div>
              <div>{COMPANY.email}</div>
            </div>
            <div style={{ flex: 1.2 }}>
              <div style={{ fontWeight: 800, color: INK }}>MAKE ALL PAYMENTS PAYABLE TO:</div>
              <div>{COMPANY.payeeName}</div>
              <div>BSB: {COMPANY.bsb} A/C: {COMPANY.account}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>#Globes not included unless otherwise stated.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const th = (align: 'left' | 'center' | 'right', width?: number): CSSProperties => ({
  padding: '8px 6px',
  textAlign: align,
  fontWeight: 800,
  fontSize: '11px',
  letterSpacing: '0.4px',
  color: INK,
  ...(width ? { width: `${width}px` } : {}),
});

const td = (align: 'left' | 'center' | 'right'): CSSProperties => ({
  padding: '10px 6px',
  textAlign: align,
  verticalAlign: 'top',
});

const totLabel: CSSProperties = {
  padding: '6px 0',
  color: MUTED,
  fontWeight: 700,
  textAlign: 'right',
  paddingRight: '14px',
  fontSize: '12px',
  letterSpacing: '0.4px',
};

const totVal = (bold = false): CSSProperties => ({
  padding: '6px 0',
  textAlign: 'right',
  fontWeight: bold ? 800 : 500,
  minWidth: '120px',
});

// ---------------------------------------------------------------- email file
// UTF-8 text -> base64 (btoa only takes Latin-1).
function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// An unsent email (RFC 822 / MIME) with one attachment. "X-Unsent: 1"
// makes Outlook open it as a new message ready to send rather than as a
// received one. No From header — Outlook uses that computer's account.
function buildEml(m: {
  to: string[];
  subject: string;
  body: string;
  attachment: { name: string; type: string; base64: string };
}): string {
  const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
  const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${utf8Base64(v)}?=`);
  const boundary = `----=_ALPOS_${Date.now().toString(36)}`;
  const lines = [
    'X-Unsent: 1',
    ...(m.to.length ? [`To: ${m.to.join(', ')}`] : []),
    `Subject: ${header(m.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(utf8Base64(m.body.replace(/\r?\n/g, '\r\n'))),
    `--${boundary}`,
    `Content-Type: ${m.attachment.type}; name="${m.attachment.name}"`,
    `Content-Disposition: attachment; filename="${m.attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(m.attachment.base64),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}
