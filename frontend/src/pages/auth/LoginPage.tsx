import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { login, pinLogin, clearError } from '../../store/slices/authSlice';
import { RootState, AppDispatch } from '../../store';

const roleColors: Record<string, string> = {
  admin: 'text-red-400 bg-red-500/20 border-red-500',
  manager: 'text-orange-400 bg-orange-500/20 border-orange-500',
  sales_staff: 'text-blue-400 bg-blue-500/20 border-blue-500',
  cashier: 'text-green-400 bg-green-500/20 border-green-500',
};

const roleLabels: Record<string, string> = {
  admin: 'Admin - Full Access',
  manager: 'Manager - Can approve discounts & refunds',
  sales_staff: 'Sales Staff - Standard POS access',
  cashier: 'Cashier - Basic POS access',
};

export default function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { isLoading, error, user } = useSelector((state: RootState) => state.auth);

  const [mode, setMode] = useState<'email' | 'pin'>('pin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');

  // Keyboard support: digits add to PIN, Enter submits, Backspace removes
  useEffect(() => {
    if (mode !== 'pin') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        if (pin.length < 6) setPin((p) => p + e.key);
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Enter' && pin.length >= 4) {
        dispatch(pinLogin(pin));
      } else if (e.key === 'Escape') {
        setPin('');
        dispatch(clearError());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, pin, dispatch]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(login({ email, password }));
  };

  const handlePinChange = (digit: string) => {
    if (pin.length < 6) {
      setPin(pin + digit);
    }
  };

  const handlePinSubmit = () => {
    if (pin.length >= 4) {
      dispatch(pinLogin(pin));
    }
  };

  const handlePinClear = () => {
    setPin('');
    dispatch(clearError());
  };

  const handlePinBackspace = () => {
    setPin(pin.slice(0, -1));
    dispatch(clearError());
  };

  return (
    <div className="card p-8">
      {/* Logo */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-primary-500">
          Australian Lighting & Fans
        </h1>
        <p className="text-gray-400 mt-2">Point of Sale System</p>
      </div>

      {/* Mode Toggle */}
      <div className="flex rounded-lg bg-pos-accent p-1 mb-6">
        <button
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'pin'
              ? 'bg-primary-600 text-white'
              : 'text-gray-400 hover:text-pos-text'
          }`}
          onClick={() => setMode('pin')}
        >
          PIN Login
        </button>
        <button
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'email'
              ? 'bg-primary-600 text-white'
              : 'text-gray-400 hover:text-pos-text'
          }`}
          onClick={() => setMode('email')}
        >
          Email Login
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Role indicator after login */}
      {user && user.role && (
        <div className={`border-2 rounded-lg px-4 py-3 mb-4 text-center ${roleColors[user.role.name] || 'text-gray-400 bg-gray-500/20 border-gray-500'}`}>
          <p className="font-bold text-lg">Welcome, {user.firstName}!</p>
          <p className="text-sm mt-1">{roleLabels[user.role.name] || user.role.displayName}</p>
        </div>
      )}

      {mode === 'pin' ? (
        /* PIN Login */
        <div>
          {/* PIN Display */}
          <div className="flex justify-center gap-3 mb-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-2xl font-mono ${
                  pin.length > i
                    ? 'border-primary-500 bg-primary-500/20'
                    : 'border-gray-600'
                }`}
              >
                {pin.length > i ? '•' : ''}
              </div>
            ))}
          </div>

          {/* Number Pad */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                className="keypad-btn"
                onClick={() => handlePinChange(num.toString())}
                disabled={isLoading}
              >
                {num}
              </button>
            ))}
            <button
              className="keypad-btn text-red-400"
              onClick={handlePinClear}
              disabled={isLoading}
            >
              C
            </button>
            <button
              className="keypad-btn"
              onClick={() => handlePinChange('0')}
              disabled={isLoading}
            >
              0
            </button>
            <button
              className="keypad-btn text-yellow-400"
              onClick={handlePinBackspace}
              disabled={isLoading}
            >
              ←
            </button>
          </div>

          {/* Enter / Submit */}
          <button
            className="btn-primary w-full mt-4 py-3 text-lg font-semibold disabled:opacity-50"
            onClick={handlePinSubmit}
            disabled={isLoading || pin.length < 4}
          >
            {isLoading ? 'Signing in...' : `Enter${pin.length >= 4 ? '' : ' (4–6 digits)'}`}
          </button>
        </div>
      ) : (
        /* Email Login */
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Email
            </label>
            <input
              type="email"
              className="input"
              placeholder="staff@store.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Password
            </label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      )}
    </div>
  );
}
