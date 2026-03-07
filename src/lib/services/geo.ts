// =============================================================================
// GMTW Trail Map — Geo-Algorithmen: Haversine, XTE, RDP, Bearing, Geofencing
// =============================================================================

import type { GpxPoint, LatLng } from '$lib/types';

const R = 6371000; // Erdradius in Metern

// --- Haversine Distance -------------------------------------------------------

/**
 * Berechnet Distanz in Metern zwischen zwei GPS-Koordinaten (Haversine-Formel).
 * Berücksichtigt sphärische Erdkrümmung.
 */
export function haversine(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Kurzform für lat/lng Paare — gibt Meter zurück */
export function dist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversine({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}

/** Alias: Haversine in Metern (lat1, lng1, lat2, lng2 einzeln) */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversine({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}

// --- Bearing -----------------------------------------------------------------

/** Berechnet Bearing (Richtungswinkel 0–360°) von a nach b */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// --- Cross-Track Error (XTE) -------------------------------------------------

/**
 * Berechnet Cross-Track Error in Metern.
 * Positiv = rechts vom Pfad, negativ = links vom Pfad.
 * Verwendet für HUD-Navigationspfeile.
 */
export function crossTrackError(pos: LatLng, segStart: LatLng, segEnd: LatLng): number {
  const d13 = haversine(segStart, pos) / R; // angular distance start→pos
  const θ13 = (bearing(segStart, pos) * Math.PI) / 180; // bearing start→pos
  const θ12 = (bearing(segStart, segEnd) * Math.PI) / 180; // bearing start→end
  return Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12)) * R;
}

// --- RDP-Algorithmus (Ramer-Douglas-Peucker) ----------------------------------

/** Senkrechter Abstand von Punkt p zur Linie (a, b) — für RDP */
function rdpPerp(pts: GpxPoint[], a: number, b: number, idx: number): number {
  const p = pts[idx];
  const pa = pts[a];
  const pb = pts[b];
  if (pa.lat === pb.lat && pa.lng === pb.lng) return haversine(pa, p);
  const dAB = haversine(pa, pb);
  const dAP = haversine(pa, p);
  const bearing_AB = (bearing(pa, pb) * Math.PI) / 180;
  const bearing_AP = (bearing(pa, p) * Math.PI) / 180;
  return Math.abs(Math.asin(Math.sin(dAP / R) * Math.sin(bearing_AP - bearing_AB)) * R);
}

function rdpIter(pts: GpxPoint[], start: number, end: number, eps: number, mask: boolean[]): void {
  if (end <= start + 1) return;
  let maxDist = 0;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const d = rdpPerp(pts, start, end, i);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > eps) {
    mask[maxIdx] = true;
    rdpIter(pts, start, maxIdx, eps, mask);
    rdpIter(pts, maxIdx, end, eps, mask);
  }
}

/**
 * RDP-Vereinfachung auf maximal `maxPts` Punkte.
 * Passt epsilon iterativ an (binäre Suche) bis Zielpunktanzahl erreicht.
 */
export function simplifyPoints(pts: GpxPoint[], maxPts: number): GpxPoint[] {
  if (pts.length <= maxPts) return pts;
  let lo = 0, hi = 100, result = pts;
  for (let iter = 0; iter < 25; iter++) {
    const eps = (lo + hi) / 2;
    const mask = new Array(pts.length).fill(false);
    mask[0] = true;
    mask[pts.length - 1] = true;
    rdpIter(pts, 0, pts.length - 1, eps, mask);
    const simplified = pts.filter((_, i) => mask[i]);
    if (simplified.length <= maxPts) {
      result = simplified;
      hi = eps;
    } else {
      lo = eps;
    }
    if (Math.abs(hi - lo) < 0.01) break;
  }
  return result;
}

// --- Line Intersection (Ziellinie) ------------------------------------------

/**
 * Prüft, ob der Weg von p1 nach p2 die Linie (lineA, lineB) kreuzt.
 * Verwendet Kreuzprodukt-Methode.
 */
export function lineCrossed(p1: LatLng, p2: LatLng, lineA: LatLng, lineB: LatLng): boolean {
  const ccw = (A: LatLng, B: LatLng, C: LatLng) =>
    (C.lat - A.lat) * (B.lng - A.lng) > (B.lat - A.lat) * (C.lng - A.lng);
  return (
    ccw(p1, lineA, lineB) !== ccw(p2, lineA, lineB) &&
    ccw(p1, p2, lineA) !== ccw(p1, p2, lineB)
  );
}

/**
 * Berechnet interpolierten Zeitstempel der Ziellinienüberquerung (Millisekunden-Präzision).
 * Annahme: konstante Geschwindigkeit zwischen p1 und p2.
 */
export function interpolateCrossTime(
  p1: LatLng & { ts: number },
  p2: LatLng & { ts: number },
  lineA: LatLng,
  lineB: LatLng
): number {
  const total = haversine(p1, p2);
  if (total === 0) return p1.ts;
  // Projektion von lineA auf die Strecke p1→p2 — vereinfacht via Bearing
  const dToA = haversine(p1, lineA);
  const frac = Math.min(1, Math.max(0, dToA / total));
  return p1.ts + frac * (p2.ts - p1.ts);
}

// --- Checkpoint-Berechnung --------------------------------------------------

/**
 * Teilt einen GPX-Track gleichmäßig in `n` Sektoren auf.
 * Gibt die Zwischenpunkte (Checkpoints) zurück, letzter = Ziel.
 * Verwendet Turf.js lineAlong (falls verfügbar) oder eigene Berechnung.
 */
export function computeCheckpoints(points: GpxPoint[], n = 4): LatLng[] {
  if (points.length < 2) return [];
  // Gesamtdistanz berechnen
  let total = 0;
  const cumDist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
    cumDist.push(total);
  }
  const checkpoints: LatLng[] = [];
  for (let s = 1; s <= n; s++) {
    const target = (total / n) * s;
    // Binärsuche des nächstgelegenen Punktes
    let lo = 0, hi = points.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumDist[mid] < target) lo = mid; else hi = mid;
    }
    checkpoints.push({ lat: points[hi].lat, lng: points[hi].lng });
  }
  return checkpoints;
}

// --- Startlinie (6m breite Linie senkrecht zum Kurs) ------------------------

/**
 * Erzeugt eine 6m breite Startlinie senkrecht zum initialen Bearing.
 * Gibt [lineA, lineB] zurück.
 */
export function computeStartLine(start: LatLng, secondPoint: LatLng): [LatLng, LatLng] {
  const b = bearing(start, secondPoint);
  const perpAngle = ((b + 90) * Math.PI) / 180;
  const delta = 3 / R; // 3 Meter in Radiant
  const lineA: LatLng = {
    lat: start.lat + (delta * 180) / Math.PI * Math.cos(perpAngle),
    lng: start.lng + (delta * 180) / Math.PI * Math.sin(perpAngle) / Math.cos((start.lat * Math.PI) / 180)
  };
  const lineB: LatLng = {
    lat: start.lat - (delta * 180) / Math.PI * Math.cos(perpAngle),
    lng: start.lng - (delta * 180) / Math.PI * Math.sin(perpAngle) / Math.cos((start.lat * Math.PI) / 180)
  };
  return [lineA, lineB];
}

// --- Distanz formatieren ----------------------------------------------------

export function formatDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSplitMs(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = (totalS % 60).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : `${s}s`;
}

// --- Snap-to-Track -----------------------------------------------------------

/**
 * Findet den nächstgelegenen Punkt auf einem GPX-Track zu einer gegebenen Position.
 * Projiziert `pos` auf jedes Streckensegment (a, b) und gibt den kürzesten Treffer zurück.
 * Kein externes Paket benötigt — geeignet für Strecken unter ~100 km.
 */
export function nearestPointOnTrack(pos: LatLng, points: GpxPoint[]): LatLng {
  if (points.length === 0) return pos;
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng };

  let nearest: LatLng = { lat: points[0].lat, lng: points[0].lng };
  let minDist = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const a: LatLng = { lat: points[i].lat,     lng: points[i].lng };
    const b: LatLng = { lat: points[i + 1].lat, lng: points[i + 1].lng };
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const lenSq = dx * dx + dy * dy;
    // Projektion von pos auf Segment a-b, t ∈ [0,1]
    const t = lenSq > 0
      ? Math.max(0, Math.min(1, ((pos.lng - a.lng) * dx + (pos.lat - a.lat) * dy) / lenSq))
      : 0;
    const np: LatLng = { lat: a.lat + t * dy, lng: a.lng + t * dx };
    const d = haversine(pos, np);
    if (d < minDist) { minDist = d; nearest = np; }
  }
  return nearest;
}
