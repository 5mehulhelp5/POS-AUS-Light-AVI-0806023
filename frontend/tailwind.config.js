/** @type {import('tailwindcss').Config} */

// Theme-aware colour helper: shades resolve to CSS variables defined in
// index.css. Day mode (default, per Sally) uses an inverted ramp; night
// mode (html.dark) restores the original dark-theme values, so existing
// class names keep working in both. The `<alpha-value>` slot keeps
// opacity modifiers (bg-gray-700/50 etc.) functional.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (family, shades) =>
  Object.fromEntries(shades.map((s) => [s, v(`${family}-${s}`)]));

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Monochrome accent palette (greyscale). Values live in CSS vars:
        // night = the original zinc ramp, day = inverted (400 is the
        // bright accent for prices — near-white at night, near-black by
        // day; 600/700 stay dark in both so btn-primary keeps white text).
        primary: scale('primary', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        // Neutral grey ramp used all over the app (text-gray-400,
        // border-gray-700, ...). Night = Tailwind's default greys
        // (pixel-identical to before theming); day = inverted zinc ramp.
        // Inside .printable-root / .paper the night values apply again so
        // receipts stay dark-text-on-white-paper in both themes.
        gray: scale('gray', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        // Light accent shades used as coloured text on dark surfaces
        // (text-green-400, text-amber-300, ...) darken by day for
        // contrast on white. Mid/dark shades (bg-green-600 buttons,
        // text-red-500, borders at 500+) are NOT overridden and keep
        // Tailwind defaults in both themes.
        red: scale('red', [300, 400]),
        green: scale('green', [200, 300, 400]),
        yellow: scale('yellow', [300, 400]),
        blue: scale('blue', [300, 400]),
        amber: scale('amber', [100, 200, 300, 400]),
        orange: scale('orange', [200, 300, 400]),
        purple: scale('purple', [200, 300, 400]),
        cyan: scale('cyan', [100, 200, 300, 400]),
        emerald: scale('emerald', [300]),
        teal: scale('teal', [300]),
        // Surfaces: near-black page/cards at night, light grey page with
        // white cards by day. Status colours are constant across themes.
        pos: {
          bg: v('pos-bg'),     // page background
          card: v('pos-card'), // panels / modals
          accent: v('pos-accent'), // raised buttons / hover surfaces / inputs
          text: v('pos-text'),
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
