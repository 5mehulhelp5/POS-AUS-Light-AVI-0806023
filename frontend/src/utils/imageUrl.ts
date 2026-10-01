// Product photos come from the Magento site, which sits behind Cloudflare
// Under Attack Mode — a browser <img> can't pass that challenge, so the
// tills showed "Image unavailable" (Sally, 1 Oct 2026). The POS server can
// reach Magento, so every external image URL is routed through
// /api/v1/product-image, which fetches it once and caches it on disk.
// Data URLs, relative paths and blanks are left alone.
export function posImage(url?: string | null): string | null {
  if (!url) return null;
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return u;
  if (typeof window !== 'undefined' && u.startsWith(window.location.origin + '/')) return u;
  return `/api/v1/product-image?src=${encodeURIComponent(u)}`;
}
