import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { suppliersApi, warrantiesApi } from '../../services/api';

interface Warranty {
  id: number;
  customerId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  supplierId: number | null;
  supplierName: string | null;
  productSku: string | null;
  productName: string | null;
  invoiceNumber: string | null;
  purchaseDate: string | null;
  claimDate: string | null;
  faultDescription: string | null;
  resolutionNotes: string | null;
  status: string;
  supplier: { id: number; name: string } | null;
  customer: { id: number; firstName: string; lastName: string } | null;
  user: { id: number; firstName: string; lastName: string } | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'bg-blue-500/20 text-blue-300' },
  awaiting_supplier: { label: 'Awaiting Supplier', color: 'bg-amber-500/20 text-amber-300' },
  approved: { label: 'Approved', color: 'bg-emerald-500/20 text-emerald-300' },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-300' },
  replaced: { label: 'Replaced', color: 'bg-purple-500/20 text-purple-300' },
  refunded: { label: 'Refunded', color: 'bg-purple-500/20 text-purple-300' },
  closed: { label: 'Closed', color: 'bg-gray-600/40 text-gray-300' },
};

const empty = {
  contactName: '',
  contactPhone: '',
  supplierId: '' as string,
  productSku: '',
  productName: '',
  invoiceNumber: '',
  purchaseDate: '',
  claimDate: '',
  faultDescription: '',
  resolutionNotes: '',
  status: 'new',
};

export default function WarrantiesPage() {
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<Warranty | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await warrantiesApi.getWarranties({
        status: statusFilter || undefined,
      });
      setWarranties(res.data.data.warranties);
    } catch {
      toast.error('Failed to load warranties');
    } finally {
      setIsLoading(false);
    }
  };

  // Loaded once for the supplier dropdown in the form.
  const loadSuppliers = async () => {
    try {
      const res = await suppliersApi.getSuppliers();
      setSuppliers(res.data.data.suppliers);
    } catch {
      // non-fatal — modal will fall back to free-text supplier name
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    loadSuppliers();
  }, []);

  const openAdd = () => {
    setEditing(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({ ...empty, claimDate: today });
    setShowModal(true);
  };

  const openEdit = (w: Warranty) => {
    setEditing(w);
    setForm({
      contactName: w.contactName || '',
      contactPhone: w.contactPhone || '',
      supplierId: w.supplierId ? String(w.supplierId) : '',
      productSku: w.productSku || '',
      productName: w.productName || '',
      invoiceNumber: w.invoiceNumber || '',
      purchaseDate: w.purchaseDate ? w.purchaseDate.slice(0, 10) : '',
      claimDate: w.claimDate ? w.claimDate.slice(0, 10) : '',
      faultDescription: w.faultDescription || '',
      resolutionNotes: w.resolutionNotes || '',
      status: w.status || 'new',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.contactName.trim() && !form.productName.trim()) {
      toast.error('Add at least a customer name or product');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        productSku: form.productSku || undefined,
        productName: form.productName || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        purchaseDate: form.purchaseDate || undefined,
        claimDate: form.claimDate || undefined,
        faultDescription: form.faultDescription || undefined,
        resolutionNotes: form.resolutionNotes || undefined,
        status: form.status,
      };
      if (editing) {
        await warrantiesApi.updateWarranty(editing.id, payload);
        toast.success('Warranty updated');
      } else {
        await warrantiesApi.createWarranty(payload);
        toast.success('Warranty claim added');
      }
      setShowModal(false);
      load();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (w: Warranty) => {
    if (!confirm('Delete this warranty claim?')) return;
    try {
      await warrantiesApi.deleteWarranty(w.id);
      toast.success('Warranty deleted');
      load();
    } catch {
      toast.error('Delete failed');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-pos-bg text-pos-text p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheckIcon className="h-7 w-7 text-primary-500" />
              Warranty Claims
            </h1>
            <p className="text-sm text-gray-400">
              Track product fault reports and supplier replacements.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="btn bg-primary-600 text-white flex items-center gap-2"
          >
            <PlusIcon className="h-5 w-5" /> New Claim
          </button>
        </div>

        {/* Status filter */}
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm text-gray-400">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-pos-card border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
          >
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-pos-card border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-pos-accent text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-3 text-left">Claim Date</th>
                <th className="px-3 py-3 text-left">Customer</th>
                <th className="px-3 py-3 text-left">Product</th>
                <th className="px-3 py-3 text-left">Supplier</th>
                <th className="px-3 py-3 text-left">Fault</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : warranties.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                    No warranty claims yet. Click "New Claim" to add one.
                  </td>
                </tr>
              ) : (
                warranties.map((w) => {
                  const status = STATUS_LABELS[w.status] || {
                    label: w.status,
                    color: 'bg-gray-600/40 text-gray-300',
                  };
                  return (
                    <tr
                      key={w.id}
                      className="border-t border-gray-800 hover:bg-pos-accent/30 align-top"
                    >
                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                        {w.claimDate ? new Date(w.claimDate).toLocaleDateString('en-AU') : '—'}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        {w.customer
                          ? `${w.customer.firstName} ${w.customer.lastName}`
                          : w.contactName || '—'}
                        {w.contactPhone && (
                          <div className="text-xs text-gray-500">{w.contactPhone}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <div>{w.productName || '—'}</div>
                        {w.productSku && (
                          <div className="text-xs text-gray-500">{w.productSku}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm">{w.supplierName || '—'}</td>
                      <td className="px-3 py-3 text-sm max-w-[260px]">
                        <div className="line-clamp-2">{w.faultDescription || '—'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs font-semibold ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openEdit(w)}
                            className="text-gray-400 hover:text-primary-400"
                            title="Edit"
                          >
                            <PencilIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(w)}
                            className="text-gray-400 hover:text-red-400"
                            title="Delete"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / edit modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="bg-pos-card border border-gray-700 rounded-lg shadow-2xl max-w-2xl w-full p-6 text-pos-text max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">
              {editing ? 'Edit Warranty Claim' : 'New Warranty Claim'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer Name">
                <input
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Customer Phone">
                <input
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Product Name">
                <input
                  value={form.productName}
                  onChange={(e) => setForm({ ...form, productName: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Product SKU">
                <input
                  value={form.productSku}
                  onChange={(e) => setForm({ ...form, productSku: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Supplier">
                <select
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  className="input"
                >
                  <option value="">— None —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Invoice Number">
                <input
                  value={form.invoiceNumber}
                  onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Purchase Date">
                <input
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Claim Date">
                <input
                  type="date"
                  value={form.claimDate}
                  onChange={(e) => setForm({ ...form, claimDate: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Status" full>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="input"
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fault Description" full>
                <textarea
                  value={form.faultDescription}
                  onChange={(e) => setForm({ ...form, faultDescription: e.target.value })}
                  className="input"
                  rows={3}
                />
              </Field>
              <Field label="Resolution Notes" full>
                <textarea
                  value={form.resolutionNotes}
                  onChange={(e) => setForm({ ...form, resolutionNotes: e.target.value })}
                  className="input"
                  rows={2}
                  placeholder="e.g. Supplier sent replacement on 14/06"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="btn bg-gray-700 text-pos-text"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn bg-primary-600 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  full = false,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-xs uppercase text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
