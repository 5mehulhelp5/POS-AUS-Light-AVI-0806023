import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  SunIcon,
  MoonIcon,
  ShoppingCartIcon,
  ClipboardDocumentListIcon,
  UsersIcon,
  DocumentTextIcon,
  PhoneIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
  BookOpenIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import { RootState, AppDispatch } from '../../store';
import { logout } from '../../store/slices/authSlice';
import { getTheme, applyTheme, Theme } from '../../utils/theme';

const navItems = [
  { to: '/pos', label: 'Products', icon: ShoppingCartIcon },
  { to: '/orders', label: 'Orders', icon: ClipboardDocumentListIcon },
  { to: '/customers', label: 'Customers', icon: UsersIcon },
  { to: '/quotes', label: 'Quotes', icon: DocumentTextIcon },
  { to: '/inquiries', label: 'Inquiries', icon: PhoneIcon },
  { to: '/suppliers', label: 'Suppliers', icon: BookOpenIcon },
  { to: '/warranties', label: 'Warranty', icon: ShieldCheckIcon },
  { to: '/users', label: 'Users', icon: UserGroupIcon },
];

const managerNavItems = [
  { to: '/reports', label: 'Reports', icon: ChartBarIcon },
];

// Sales staff get the Backorders report only, read-only (Sally, 15 Oct 2026).
const staffNavItems = [
  { to: '/reports', label: 'Backorders', icon: ChartBarIcon },
];

const adminNavItems = [
  { to: '/competitor-prices', label: 'Prices', icon: CurrencyDollarIcon },
  { to: '/settings', label: 'Settings', icon: Cog6ToothIcon },
];

export default function MainLayout() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  // Lock after 20 minutes without use (Sally, 13 Oct 2026: "staff have to
  // re-enter their passcode if they haven't used the POS for more than
  // 20mins"). Any mouse / key / touch activity resets it, in any open POS
  // window (shared through localStorage). The cart isn't touched, so a
  // sale in progress is still there after the next PIN login.
  useEffect(() => {
    const IDLE_LIMIT_MS = 20 * 60 * 1000;
    const KEY = 'pos_last_activity';
    let last = Date.now();
    const mark = () => {
      try {
        localStorage.setItem(KEY, String(last));
      } catch {
        // storage blocked — this window's own timer still works
      }
    };
    mark();
    const onActivity = () => {
      const now = Date.now();
      // Write at most every 15s; the lock doesn't need finer timing.
      if (now - last > 15000) {
        last = now;
        mark();
      }
    };
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      let seen = last;
      try {
        seen = Math.max(last, Number(localStorage.getItem(KEY)) || 0);
      } catch {
        // ignore
      }
      if (Date.now() - seen >= IDLE_LIMIT_MS) {
        window.clearInterval(timer);
        dispatch(logout());
        navigate('/login');
        toast('Locked after 20 minutes without use — enter your PIN to continue', {
          icon: '🔒',
          duration: 8000,
        });
      }
    }, 30000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(timer);
    };
  }, [dispatch, navigate]);

  const [theme, setTheme] = useState<Theme>(getTheme);
  const toggleTheme = () => {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    applyTheme(next);
    setTheme(next);
  };

  const isAdmin = user?.role.name === 'admin';
  const isManagerOrAdmin = user?.role.name === 'admin' || user?.role.name === 'manager';

  return (
    <div className="flex h-screen bg-pos-bg">
      {/* Sidebar */}
      <aside className="w-20 bg-pos-card border-r border-gray-700 flex flex-col">
        {/* Logo */}
        <div className="h-12 flex items-center justify-center border-b border-gray-700">
          <span className="text-xl font-bold text-primary-500">ALF</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center h-12 mx-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:bg-pos-accent hover:text-pos-text'
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </NavLink>
          ))}

          {(isManagerOrAdmin ? managerNavItems : staffNavItems).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center h-12 mx-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:bg-pos-accent hover:text-pos-text'
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="border-t border-gray-700 mx-3 my-1" />
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center h-12 mx-1 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-400 hover:bg-pos-accent hover:text-pos-text'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-[10px] mt-0.5">{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User & Logout */}
        <div className="border-t border-gray-700 p-1">
          <button
            onClick={toggleTheme}
            className="w-full flex flex-col items-center justify-center h-10 rounded-lg text-gray-400 hover:bg-pos-accent hover:text-pos-text transition-colors mb-1"
            title={theme === 'day' ? 'Switch to night mode' : 'Switch to day mode'}
          >
            {theme === 'day' ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />}
            <span className="text-[10px] mt-0.5">{theme === 'day' ? 'Night' : 'Day'}</span>
          </button>
          <div className="flex flex-col items-center text-center mb-1">
            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
              {user?.firstName[0]}
              {user?.lastName[0]}
            </div>
            <span className="text-[10px] text-gray-400 mt-0.5 truncate w-full">
              {user?.firstName}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex flex-col items-center justify-center h-10 rounded-lg text-gray-400 hover:bg-red-600/20 hover:text-red-400 transition-colors"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            <span className="text-[10px] mt-0.5">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
