import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { inquiriesApi, usersApi } from '../../services/api';
import {
  MagnifyingGlassIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserGroupIcon,
  ChatBubbleLeftIcon,
  PlusIcon,
  ArrowLeftIcon,
  PencilIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

interface StaffRef {
  id: number;
  firstName: string;
  lastName: string;
}

interface Inquiry {
  id: number;
  type: string;
  status: string;
  subject: string | null;
  description: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  followUpDate: string | null;
  customer: { id: number; firstName: string; lastName: string } | null;
  user: { id: number; firstName: string; lastName: string };
  assignedTo: StaffRef | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function InquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newInquiry, setNewInquiry] = useState({
    type: 'phone_call',
    subject: '',
    description: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    followUpDate: '',
    assignedToUserId: '' as string,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Staff list for the "Assign to" dropdown.
  const [staff, setStaff] = useState<StaffRef[]>([]);

  // Edit modal state
  const [editingInquiry, setEditingInquiry] = useState<Inquiry | null>(null);
  const [editForm, setEditForm] = useState({
    type: 'phone_call',
    subject: '',
    description: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    followUpDate: '',
    status: 'new',
    assignedToUserId: '' as string,
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    fetchInquiries();
  }, [pagination.page, statusFilter, typeFilter]);

  useEffect(() => {
    usersApi
      .getUsers({ active: true, limit: 100 })
      .then((r) => setStaff(r.data?.data?.users || []))
      .catch(() => setStaff([]));
  }, []);

  const openEditInquiry = (inq: Inquiry) => {
    setEditForm({
      type: inq.type,
      subject: inq.subject || '',
      description: inq.description || '',
      contactName: inq.contactName || '',
      contactPhone: (inq.contactPhone || '').replace(/\D/g, ''),
      contactEmail: inq.contactEmail || '',
      followUpDate: inq.followUpDate ? inq.followUpDate.slice(0, 10) : '',
      status: inq.status,
      assignedToUserId: inq.assignedTo ? String(inq.assignedTo.id) : '',
    });
    setEditingInquiry(inq);
  };

  const handleUpdateInquiry = async () => {
    if (!editingInquiry) return;
    if (!editForm.subject.trim()) {
      toast.error('Subject is required');
      return;
    }
    const phoneDigits = (editForm.contactPhone || '').replace(/\D+/g, '');
    if (editForm.contactPhone.trim() && phoneDigits.length !== 10) {
      toast.error(`Phone must be exactly 10 digits — you entered ${phoneDigits.length}`);
      return;
    }
    setIsSavingEdit(true);
    try {
      await inquiriesApi.updateInquiry(editingInquiry.id, {
        type: editForm.type,
        subject: editForm.subject,
        description: editForm.description || undefined,
        contactName: editForm.contactName || undefined,
        contactPhone: phoneDigits || undefined,
        contactEmail: editForm.contactEmail || undefined,
        followUpDate: editForm.followUpDate || undefined,
        status: editForm.status,
        assignedToUserId: editForm.assignedToUserId
          ? Number(editForm.assignedToUserId)
          : null,
      });
      toast.success('Enquiry updated');
      setEditingInquiry(null);
      setSelectedInquiry(null);
      fetchInquiries();
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to update enquiry');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Quick status change (e.g. mark complete/resolved) without opening
  // the full edit form.
  const setInquiryStatus = async (inq: Inquiry, status: string) => {
    try {
      await inquiriesApi.updateInquiry(inq.id, { status });
      toast.success(`Marked ${status.replace('_', ' ')}`);
      setSelectedInquiry(null);
      fetchInquiries();
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to update status');
    }
  };

  const fetchInquiries = async () => {
    try {
      setIsLoading(true);
      const response = await inquiriesApi.getInquiries({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        page: pagination.page,
        limit: 20,
      });
      setInquiries(response.data.data.inquiries);
      setPagination(response.data.data.pagination);
    } catch (error) {
      console.error('Failed to fetch inquiries:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddInquiry = async () => {
    if (!newInquiry.subject.trim()) return;
    // 10-digit phone gate. Cashiers commonly drop a digit; fail fast
    // before hitting the API.
    const phoneDigits = (newInquiry.contactPhone || '').replace(/\D+/g, '');
    if (newInquiry.contactPhone.trim() && phoneDigits.length !== 10) {
      alert(`Phone must be exactly 10 digits — you entered ${phoneDigits.length}`);
      return;
    }
    try {
      setIsSubmitting(true);
      await inquiriesApi.createInquiry({
        type: newInquiry.type,
        subject: newInquiry.subject,
        description: newInquiry.description || undefined,
        contactName: newInquiry.contactName || undefined,
        contactPhone: phoneDigits || undefined,
        contactEmail: newInquiry.contactEmail || undefined,
        followUpDate: newInquiry.followUpDate || undefined,
        assignedToUserId: newInquiry.assignedToUserId
          ? Number(newInquiry.assignedToUserId)
          : null,
      });
      setShowAddModal(false);
      setNewInquiry({ type: 'phone_call', subject: '', description: '', contactName: '', contactPhone: '', contactEmail: '', followUpDate: '', assignedToUserId: '' });
      fetchInquiries();
    } catch (error) {
      console.error('Failed to create inquiry:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      new: 'bg-blue-600',
      in_progress: 'bg-yellow-600',
      resolved: 'bg-green-600',
      converted: 'bg-purple-600',
    };
    const labels: Record<string, string> = {
      new: 'NEW',
      in_progress: 'IN PROGRESS',
      resolved: 'RESOLVED',
      converted: 'CONVERTED',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-gray-600'}`}>
        {labels[status] || status.toUpperCase()}
      </span>
    );
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'phone_call':
        return <PhoneIcon className="h-5 w-5" />;
      case 'email':
        return <EnvelopeIcon className="h-5 w-5" />;
      case 'walk_in':
        return <UserGroupIcon className="h-5 w-5" />;
      default:
        return <ChatBubbleLeftIcon className="h-5 w-5" />;
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      walk_in: 'Walk-in',
      phone_call: 'Phone',
      email: 'Email',
      other: 'Other',
    };
    return labels[type] || type;
  };

  const filteredInquiries = inquiries.filter(
    (inquiry) =>
      inquiry.subject?.toLowerCase().includes(search.toLowerCase()) ||
      inquiry.contactName?.toLowerCase().includes(search.toLowerCase()) ||
      inquiry.customer?.firstName?.toLowerCase().includes(search.toLowerCase()) ||
      inquiry.customer?.lastName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Inquiries & Calls</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            Total: {pagination.total} inquiries
          </span>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => setShowAddModal(true)}
          >
            <PlusIcon className="h-5 w-5" />
            Add Enquiry
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by subject or contact..."
            className="input pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="converted">Converted</option>
        </select>
        <select
          className="input w-40"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All Types</option>
          <option value="walk_in">Walk-in</option>
          <option value="phone_call">Phone Call</option>
          <option value="email">Email</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Inquiries Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading inquiries...</div>
        ) : filteredInquiries.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No inquiries found</div>
        ) : (
          <table className="w-full">
            <thead className="bg-pos-accent">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Subject</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Contact</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Follow Up</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Assigned To</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Logged By</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredInquiries.map((inquiry) => (
                <tr
                  key={inquiry.id}
                  className="hover:bg-pos-accent/50 cursor-pointer"
                  onClick={() => setSelectedInquiry(inquiry)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(inquiry.type)}
                      <span>{getTypeLabel(inquiry.type)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {inquiry.subject || 'No subject'}
                  </td>
                  <td className="px-4 py-3">
                    {inquiry.customer
                      ? `${inquiry.customer.firstName} ${inquiry.customer.lastName}`
                      : inquiry.contactName || '-'}
                  </td>
                  <td className="px-4 py-3">{getStatusBadge(inquiry.status)}</td>
                  <td className="px-4 py-3 text-sm">
                    {inquiry.followUpDate
                      ? new Date(inquiry.followUpDate).toLocaleDateString('en-AU')
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {inquiry.assignedTo
                      ? `${inquiry.assignedTo.firstName} ${inquiry.assignedTo.lastName}`
                      : <span className="text-gray-500">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">{inquiry.user.firstName}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {formatDate(inquiry.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            className="btn-sm"
            disabled={pagination.page <= 1}
            onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            className="btn-sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
          >
            Next
          </button>
        </div>
      )}

      {/* Add Enquiry Modal */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex justify-between items-center mb-4">
              <button onClick={() => setShowAddModal(false)} className="modal-back-btn">
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <h2 className="text-xl font-bold">Add Enquiry</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Type *</label>
                <select
                  className="input w-full"
                  value={newInquiry.type}
                  onChange={(e) => setNewInquiry({ ...newInquiry, type: e.target.value })}
                >
                  <option value="phone_call">Phone Call</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="email">Email</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Subject *</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="Brief subject..."
                  value={newInquiry.subject}
                  onChange={(e) => setNewInquiry({ ...newInquiry, subject: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea
                  className="input w-full"
                  rows={3}
                  placeholder="Details about the enquiry..."
                  value={newInquiry.description}
                  onChange={(e) => setNewInquiry({ ...newInquiry, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Contact Name</label>
                  <input
                    type="text"
                    className="input w-full"
                    placeholder="Customer name"
                    value={newInquiry.contactName}
                    onChange={(e) => setNewInquiry({ ...newInquiry, contactName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Contact Phone <span className="text-gray-500">(10 digits)</span>
                  </label>
                  <input
                    type="tel"
                    className="input w-full"
                    inputMode="numeric"
                    placeholder="0434310130"
                    value={newInquiry.contactPhone}
                    onChange={(e) => setNewInquiry({ ...newInquiry, contactPhone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Contact Email</label>
                  <input
                    type="email"
                    className="input w-full"
                    placeholder="email@example.com"
                    value={newInquiry.contactEmail}
                    onChange={(e) => setNewInquiry({ ...newInquiry, contactEmail: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Follow Up Date</label>
                  <input
                    type="date"
                    className="input w-full"
                    value={newInquiry.followUpDate}
                    onChange={(e) => setNewInquiry({ ...newInquiry, followUpDate: e.target.value })}
                  />
                </div>
              </div>
              {/* Assign to a colleague — e.g. taking a phone message for
                  someone else to call the customer back. */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Assign To</label>
                <select
                  className="input w-full"
                  value={newInquiry.assignedToUserId}
                  onChange={(e) => setNewInquiry({ ...newInquiry, assignedToUserId: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                className="btn-sm flex-1 bg-gray-600 text-pos-text"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                onClick={handleAddInquiry}
                disabled={!newInquiry.subject.trim() || isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Save Enquiry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Enquiry Modal */}
      {editingInquiry && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex justify-between items-center mb-4">
              <button onClick={() => setEditingInquiry(null)} className="modal-back-btn">
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <h2 className="text-xl font-bold">Edit Enquiry</h2>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Type *</label>
                  <select
                    className="input w-full"
                    value={editForm.type}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  >
                    <option value="phone_call">Phone Call</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="email">Email</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Status</label>
                  <select
                    className="input w-full"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="new">New</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="converted">Converted</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Subject *</label>
                <input
                  type="text"
                  className="input w-full"
                  value={editForm.subject}
                  onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea
                  className="input w-full"
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Contact Name</label>
                  <input
                    type="text"
                    className="input w-full"
                    value={editForm.contactName}
                    onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Contact Phone <span className="text-gray-500">(10 digits)</span>
                  </label>
                  <input
                    type="tel"
                    className="input w-full"
                    inputMode="numeric"
                    maxLength={10}
                    value={editForm.contactPhone}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        contactPhone: e.target.value.replace(/\D/g, '').slice(0, 10),
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Contact Email</label>
                  <input
                    type="email"
                    className="input w-full"
                    value={editForm.contactEmail}
                    onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Follow Up Date</label>
                  <input
                    type="date"
                    className="input w-full"
                    value={editForm.followUpDate}
                    onChange={(e) => setEditForm({ ...editForm, followUpDate: e.target.value })}
                  />
                </div>
              </div>
              {/* Assign to a staff member — e.g. a phone message for a
                  colleague to call the customer back. */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Assign To</label>
                <select
                  className="input w-full"
                  value={editForm.assignedToUserId}
                  onChange={(e) => setEditForm({ ...editForm, assignedToUserId: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                className="btn-sm flex-1 bg-gray-600 text-pos-text"
                onClick={() => setEditingInquiry(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                onClick={handleUpdateInquiry}
                disabled={!editForm.subject.trim() || isSavingEdit}
              >
                {isSavingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inquiry Detail Modal */}
      {selectedInquiry && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex justify-between items-start mb-4">
              <button
                onClick={() => setSelectedInquiry(null)}
                className="modal-back-btn"
              >
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-600 rounded-full">
                  {getTypeIcon(selectedInquiry.type)}
                </div>
                <div>
                  <h2 className="text-xl font-bold">
                    {selectedInquiry.subject || 'No subject'}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    {getStatusBadge(selectedInquiry.status)}
                    <span className="text-sm text-gray-400">
                      {getTypeLabel(selectedInquiry.type)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                className="btn-sm bg-pos-accent text-gray-200 flex items-center gap-1 hover:bg-pos-bg"
                onClick={() => openEditInquiry(selectedInquiry)}
              >
                <PencilIcon className="h-4 w-4" /> Edit
              </button>
              {selectedInquiry.status !== 'in_progress' &&
                selectedInquiry.status !== 'resolved' && (
                  <button
                    className="btn-sm bg-blue-600 text-white"
                    onClick={() => setInquiryStatus(selectedInquiry, 'in_progress')}
                  >
                    Mark In Progress
                  </button>
                )}
              {selectedInquiry.status !== 'resolved' && (
                <button
                  className="btn-sm bg-green-600 text-white flex items-center gap-1"
                  onClick={() => setInquiryStatus(selectedInquiry, 'resolved')}
                >
                  <CheckCircleIcon className="h-4 w-4" /> Mark Complete
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">Contact</p>
                  <p>
                    {selectedInquiry.customer
                      ? `${selectedInquiry.customer.firstName} ${selectedInquiry.customer.lastName}`
                      : selectedInquiry.contactName || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Phone</p>
                  <p>{selectedInquiry.contactPhone || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Email</p>
                  <p>{selectedInquiry.contactEmail || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Follow Up</p>
                  <p>
                    {selectedInquiry.followUpDate
                      ? new Date(selectedInquiry.followUpDate).toLocaleDateString('en-AU')
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Assigned To</p>
                  <p>
                    {selectedInquiry.assignedTo
                      ? `${selectedInquiry.assignedTo.firstName} ${selectedInquiry.assignedTo.lastName}`
                      : 'Unassigned'}
                  </p>
                </div>
              </div>

              {selectedInquiry.description && (
                <div>
                  <p className="text-sm text-gray-400">Description</p>
                  <p className="bg-pos-dark p-3 rounded mt-1 text-sm">
                    {selectedInquiry.description}
                  </p>
                </div>
              )}

              <div className="border-t border-gray-700 pt-4">
                <div className="flex justify-between text-sm text-gray-400">
                  <span>Logged by {selectedInquiry.user.firstName}</span>
                  <span>{formatDate(selectedInquiry.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
