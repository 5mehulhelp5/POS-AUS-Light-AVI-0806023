import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { usersApi } from '../../services/api';
import {
  UserIcon,
  EnvelopeIcon,
  KeyIcon,
  PlusIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';

interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  pinCode: string;
  isActive: boolean;
  role: {
    id: number;
    name: string;
    displayName: string;
    maxDiscountPercent: number;
  };
  createdAt: string;
}

interface Role {
  id: number;
  name: string;
  displayName: string;
}

export default function UsersPage() {
  const { user: currentUser } = useSelector((state: RootState) => state.auth);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Form state for new user
  const [newUser, setNewUser] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    pinCode: '',
    roleId: 1,
  });

  const currentUserRole = currentUser?.role?.name?.toLowerCase() || '';
  const isAdmin = currentUserRole === 'admin';

  useEffect(() => {
    if (currentUser) {
      fetchUsers();
      if (isAdmin) {
        fetchRoles();
      }
    }
  }, [currentUser]);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const response = await usersApi.getUsers({ limit: 100 });
      const allUsers: User[] = response.data.data.users;

      // Get role fresh from currentUser
      const role = currentUser?.role?.name?.toLowerCase() || '';

      // Filter users based on current user's role
      let filteredUsers: User[];

      if (role === 'admin') {
        // Admin can see all users
        filteredUsers = allUsers;
      } else if (role === 'manager') {
        // Manager can see managers and sales persons
        filteredUsers = allUsers.filter(
          (u) =>
            u.role.name.toLowerCase() === 'manager' ||
            u.role.name.toLowerCase() === 'sales_staff' ||
            u.role.name.toLowerCase() === 'sales'
        );
      } else {
        // Sales can only see their own profile
        filteredUsers = allUsers.filter((u) => u.id === currentUser?.id);
      }

      setUsers(filteredUsers);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const response = await usersApi.getRoles();
      setRoles(response.data.data.roles);
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setIsCreating(true);

    try {
      // Strip blank email / password so casuals without them send nulls
      const payload: any = {
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        roleId: newUser.roleId,
        pinCode: newUser.pinCode,
      };
      if (newUser.email && newUser.email.trim()) payload.email = newUser.email.trim();
      if (newUser.password && newUser.password.trim()) payload.password = newUser.password;

      await usersApi.createUser(payload);
      setShowCreateModal(false);
      setNewUser({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        pinCode: '',
        roleId: 1,
      });
      fetchUsers();
    } catch (error: any) {
      setCreateError(
        error.response?.data?.message || 'Failed to create user'
      );
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const getRoleBadge = (roleName: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-600',
      manager: 'bg-blue-600',
      sales: 'bg-green-600',
      sales_staff: 'bg-green-600',
    };
    const labels: Record<string, string> = {
      admin: 'ADMIN',
      manager: 'MANAGER',
      sales: 'SALES',
      sales_staff: 'SALES',
    };
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium ${
          colors[roleName.toLowerCase()] || 'bg-gray-600'
        }`}
      >
        {labels[roleName.toLowerCase()] || roleName.toUpperCase()}
      </span>
    );
  };

  const getPageTitle = () => {
    if (currentUserRole === 'admin') {
      return 'All Users';
    } else if (currentUserRole === 'manager') {
      return 'Team Members';
    } else {
      return 'My Profile';
    }
  };

  const getPageSubtitle = () => {
    if (currentUserRole === 'admin') {
      return 'Manage all system users';
    } else if (currentUserRole === 'manager') {
      return 'View managers and sales staff';
    } else {
      return 'View your profile details';
    }
  };

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{getPageTitle()}</h1>
          <p className="text-sm text-gray-400">{getPageSubtitle()}</p>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PlusIcon className="h-5 w-5" />
              Add User
            </button>
          )}
          <div className="text-sm text-gray-400">
            Total: {users.length} user{users.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full p-8 text-center text-gray-400">
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="col-span-full p-8 text-center text-gray-400">
            No users found
          </div>
        ) : (
          users.map((user) => (
            <div
              key={user.id}
              className={`card p-4 cursor-pointer hover:bg-pos-accent/50 transition-colors ${
                user.id === currentUser?.id ? 'ring-2 ring-primary-500' : ''
              }`}
              onClick={() => setSelectedUser(user)}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-full ${
                    user.isActive ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <UserIcon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">
                      {user.firstName} {user.lastName}
                    </h3>
                    {user.id === currentUser?.id && (
                      <span className="text-xs text-primary-400">(You)</span>
                    )}
                  </div>
                  <div className="mt-1">{getRoleBadge(user.role.name)}</div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <EnvelopeIcon className="h-4 w-4" />
                      <span className="truncate">{user.email}</span>
                    </div>
                  </div>
                  {!user.isActive && (
                    <div className="mt-2">
                      <span className="text-xs text-red-400">Inactive</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex justify-between items-start mb-4">
              <button
                onClick={() => setSelectedUser(null)}
                className="modal-back-btn"
              >
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <div className="flex items-center gap-3">
                <div
                  className={`p-3 rounded-full ${
                    selectedUser.isActive ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <UserIcon className="h-8 w-8" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">
                    {selectedUser.firstName} {selectedUser.lastName}
                    {selectedUser.id === currentUser?.id && (
                      <span className="text-sm text-primary-400 ml-2">(You)</span>
                    )}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    {getRoleBadge(selectedUser.role.name)}
                    {!selectedUser.isActive && (
                      <span className="text-xs text-red-400 bg-red-900/30 px-2 py-0.5 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">Email</p>
                  <p>{selectedUser.email}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Role</p>
                  <p>{selectedUser.role.displayName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Max Discount</p>
                  <p>{selectedUser.role.maxDiscountPercent}%</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Status</p>
                  <p>{selectedUser.isActive ? 'Active' : 'Inactive'}</p>
                </div>
              </div>

              {/* Show PIN only to the user themselves or admin */}
              {(selectedUser.id === currentUser?.id || currentUserRole === 'admin') && (
                <div className="bg-pos-dark p-3 rounded">
                  <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
                    <KeyIcon className="h-4 w-4" />
                    <span>PIN Code</span>
                  </div>
                  <p className="font-mono text-lg tracking-widest">
                    {selectedUser.pinCode}
                  </p>
                </div>
              )}

              <div className="border-t border-gray-700 pt-4">
                <p className="text-sm text-gray-400">
                  Member since {formatDate(selectedUser.createdAt)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="flex justify-between items-center mb-4">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateError('');
                }}
                className="modal-back-btn"
              >
                <ArrowLeftIcon className="h-5 w-5" /> Back
              </button>
              <h2 className="text-xl font-bold">Create New User</h2>
            </div>

            {createError && (
              <div className="bg-red-600/20 border border-red-600 text-red-400 px-4 py-2 rounded mb-4">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={newUser.firstName}
                    onChange={(e) =>
                      setNewUser({ ...newUser, firstName: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={newUser.lastName}
                    onChange={(e) =>
                      setNewUser({ ...newUser, lastName: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Email (optional for PIN-only staff)</label>
                <input
                  type="email"
                  className="input"
                  placeholder="Optional - required for email login"
                  value={newUser.email}
                  onChange={(e) =>
                    setNewUser({ ...newUser, email: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Password (optional — leave blank for PIN-only login)
                </label>
                <input
                  type="password"
                  className="input"
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser({ ...newUser, password: e.target.value })
                  }
                  minLength={8}
                  placeholder="Leave blank for casuals"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    PIN Code * (4–6 digits)
                  </label>
                  <input
                    type="text"
                    className="input font-mono tracking-widest"
                    value={newUser.pinCode}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setNewUser({ ...newUser, pinCode: value });
                    }}
                    placeholder="0000"
                    minLength={4}
                    maxLength={6}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Role</label>
                  <select
                    className="input"
                    value={newUser.roleId}
                    onChange={(e) =>
                      setNewUser({ ...newUser, roleId: Number(e.target.value) })
                    }
                    required
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError('');
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-pos-text"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="btn-primary"
                >
                  {isCreating ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
