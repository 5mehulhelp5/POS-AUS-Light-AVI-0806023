// Day/night mode. Day is the default (Sally's call, 9 Sep 2026); night
// is opt-in per device via the sidebar toggle and remembered in
// localStorage. The theme is just a `dark` class on <html> — every
// colour resolves through CSS variables scoped on it (see index.css).

export type Theme = 'day' | 'night';

const KEY = 'pos_theme';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'night' ? 'night' : 'day';
  } catch {
    return 'day';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'night');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private browsing etc. — theme still applies for this page load
  }
}

/** Call once before first render so there's no flash of the wrong theme. */
export function initTheme() {
  document.documentElement.classList.toggle('dark', getTheme() === 'night');
}
