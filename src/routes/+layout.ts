// GMTW Trail Map — client-only SPA
// Disable SSR to avoid hydration mismatches with browser-only APIs
// (Leaflet, GPS, IndexedDB). Static adapter handles production.
export const ssr = false;
export const prerender = false;
