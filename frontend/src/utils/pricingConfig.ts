import { useEffect, useState } from 'react';
import { productsApi } from '../services/api';

// Minimum margin over cost, as a percent. Lives in the
// `min_margin_percent` setting (Settings -> Trade Pricing); 20 since
// Sally's 29 Sep 2026 change from 30. The server enforces it — this is
// only so the till can warn with the same number.
export const DEFAULT_MIN_MARGIN_PERCENT = 20;

let cached: number | null = null;
let inflight: Promise<number> | null = null;
const listeners = new Set<(v: number) => void>();

export function loadMinMarginPercent(force = false): Promise<number> {
  if (!force && cached != null) return Promise.resolve(cached);
  if (!force && inflight) return inflight;
  inflight = productsApi
    .getPricingConfig()
    .then((r) => {
      const n = Number(r.data?.data?.minMarginPercent);
      cached = Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_MARGIN_PERCENT;
      listeners.forEach((fn) => fn(cached as number));
      return cached as number;
    })
    .catch(() => cached ?? DEFAULT_MIN_MARGIN_PERCENT)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Called after an admin saves a new value so every open screen updates.
export function setCachedMinMarginPercent(v: number): void {
  cached = v;
  listeners.forEach((fn) => fn(v));
}

export function useMinMarginPercent(): number {
  const [value, setValue] = useState<number>(cached ?? DEFAULT_MIN_MARGIN_PERCENT);
  useEffect(() => {
    listeners.add(setValue);
    loadMinMarginPercent().then(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

// A percent for display: at most 2 decimals, no trailing zeros. A fixed
// trade price is carried as an exact % (e.g. 21.886970) that must never
// be printed raw.
export function fmtPct(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 100) / 100);
}
