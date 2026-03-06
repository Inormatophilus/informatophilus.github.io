// =============================================================================
// GMTW Trail Map — Navigation HUD Store (Svelte 5 Runes)
//
// Turn-by-Turn Navigation entlang eines GPX-Tracks:
// - Cross-Track Error (Links/Rechts Abweichung)
// - Bearing zum nächsten Checkpoint
// - Distanz zum nächsten Punkt
// - Automatischer Checkpoint-Wechsel
// =============================================================================

import { haversine, crossTrackError, bearing, formatDist } from '$lib/services/geo';
import { tracksStore } from './tracks.svelte';
import { mapStore } from './map.svelte';
import { app } from './app.svelte';
import type { GpxPoint, LatLng, NavState } from '$lib/types';

export type TurnIndicator = 'left' | 'right' | 'straight';

// Navigation constants
const CP_RADIUS_M   = 20; // meters to advance to next checkpoint
const MAX_SEGMENTS  = 200; // max waypoints for nav (simplified track)

// ---------------------------------------------------------------------------
// NavigationStore class
// ---------------------------------------------------------------------------

class NavigationStore {
  active        = $state(false);
  trackId       = $state<string | null>(null);
  cpIdx         = $state(0);
  distToNext    = $state(0);       // meters
  xte           = $state(0);       // cross-track error meters (+ = right, - = left)
  bearingToNext = $state(0);       // degrees 0-360
  nextLabel     = $state('');
  totalDist     = $state(0);       // total track distance m
  coveredDist   = $state(0);       // covered so far m
  turnDelta     = $state(0);       // bearing(50m ahead) - bearing(20m ahead), normalized -180..180
  closestSegIdx = $state(0);       // index of closest segment on track

  // Derived
  distFormatted    = $derived(formatDist(this.distToNext));
  coveredFormatted = $derived(formatDist(this.coveredDist));
  totalFormatted   = $derived(formatDist(this.totalDist));
  xteFormatted     = $derived(
    Math.abs(this.xte) < 1
      ? '0m'
      : `${Math.abs(this.xte).toFixed(0)}m ${this.xte > 0 ? 'rechts' : 'links'}`
  );
  progress = $derived(
    this.totalDist > 0 ? Math.min(1, this.coveredDist / this.totalDist) : 0
  );
  // Turn direction: compare bearing 20m ahead vs 50m ahead
  turnIndicator = $derived<TurnIndicator>(
    this.turnDelta < -50 ? 'left' :
    this.turnDelta > 50  ? 'right' : 'straight'
  );

  private _trackPoints: GpxPoint[] = [];
  private _gpsSub: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Start / Stop
  // ---------------------------------------------------------------------------

  start(trackId: string): void {
    const points = tracksStore.getPointsForTrack(trackId);
    if (points.length < 2) {
      app.toast('Track hat zu wenige Punkte', 'error');
      return;
    }
    this._trackPoints = points;
    this.trackId     = trackId;
    this.cpIdx       = 0;
    this.totalDist   = _trackLengthM(points);
    this.coveredDist = 0;
    this.active      = true;
    this._updateFromPos();
    app.toast('Navigation gestartet', 'info');
  }

  stop(): void {
    this.active  = false;
    this.trackId = null;
    this._trackPoints = [];
    this.cpIdx   = 0;
    app.toast('Navigation beendet', 'info');
  }

  toggle(trackId: string): void {
    if (this.active && this.trackId === trackId) this.stop();
    else this.start(trackId);
  }

  // ---------------------------------------------------------------------------
  // Process GPS Update (called from map store GPS callback)
  // ---------------------------------------------------------------------------

  processPosition(lat: number, lng: number): void {
    if (!this.active || this._trackPoints.length < 2) return;
    const pos: LatLng = { lat, lng };

    // Find closest segment
    let closestSegIdx = this.cpIdx;
    let closestDist   = Infinity;
    const searchEnd   = Math.min(this._trackPoints.length - 1, this.cpIdx + 30);
    for (let i = this.cpIdx; i < searchEnd; i++) {
      const segStart: LatLng = { lat: this._trackPoints[i].lat,     lng: this._trackPoints[i].lng };
      const segEnd:   LatLng = { lat: this._trackPoints[i + 1].lat, lng: this._trackPoints[i + 1].lng };
      const mid: LatLng = {
        lat: (segStart.lat + segEnd.lat) / 2,
        lng: (segStart.lng + segEnd.lng) / 2,
      };
      const d = haversine(pos, mid); // meters
      if (d < closestDist) {
        closestDist   = d;
        closestSegIdx = i;
      }
    }

    this.closestSegIdx = closestSegIdx;

    // XTE from closest segment
    if (closestSegIdx < this._trackPoints.length - 1) {
      const segStart: LatLng = { lat: this._trackPoints[closestSegIdx].lat,     lng: this._trackPoints[closestSegIdx].lng };
      const segEnd:   LatLng = { lat: this._trackPoints[closestSegIdx + 1].lat, lng: this._trackPoints[closestSegIdx + 1].lng };
      this.xte = crossTrackError(pos, segStart, segEnd);
    }

    // Turn detection: bearing 20m ahead vs 50m ahead (spec: delta < -50° = left, > 50° = right)
    const bear20 = this._bearingAtDistanceM(closestSegIdx, 20);
    const bear50 = this._bearingAtDistanceM(closestSegIdx, 50);
    if (bear20 !== null && bear50 !== null) {
      let delta = bear50 - bear20;
      if (delta > 180)  delta -= 360;
      if (delta < -180) delta += 360;
      this.turnDelta = delta;
    }

    // Next checkpoint: advance if within radius
    const nextPt = this._trackPoints[this.cpIdx + 1] ?? this._trackPoints[this._trackPoints.length - 1];
    const nextPos: LatLng = { lat: nextPt.lat, lng: nextPt.lng };
    const distToNext = haversine(pos, nextPos); // meters
    this.distToNext = distToNext;

    if (distToNext < CP_RADIUS_M && this.cpIdx < this._trackPoints.length - 2) {
      this.cpIdx++;
      this.coveredDist = _partialLengthM(this._trackPoints, this.cpIdx);
    }

    // Bearing
    this.bearingToNext = bearing(pos, nextPos);

    // Label
    this.nextLabel = `WP ${this.cpIdx + 1}/${this._trackPoints.length}`;

    // Check finish
    if (this.cpIdx >= this._trackPoints.length - 2 && distToNext < 10) {
      app.toast('Ziel erreicht!', 'success');
      this.stop();
    }
  }

  private _updateFromPos(): void {
    if (mapStore.gpsPos) {
      this.processPosition(mapStore.gpsPos.lat, mapStore.gpsPos.lng);
    }
  }

  /**
   * Walk along track from fromIdx, find the point distM meters ahead,
   * and return the bearing from fromIdx's position to that point.
   */
  private _bearingAtDistanceM(fromIdx: number, distM: number): number | null {
    if (fromIdx >= this._trackPoints.length - 1) return null;
    const origin: LatLng = { lat: this._trackPoints[fromIdx].lat, lng: this._trackPoints[fromIdx].lng };
    let remaining = distM;
    let i = fromIdx;
    while (i < this._trackPoints.length - 1) {
      const a: LatLng = { lat: this._trackPoints[i].lat,     lng: this._trackPoints[i].lng };
      const b: LatLng = { lat: this._trackPoints[i + 1].lat, lng: this._trackPoints[i + 1].lng };
      const segLen = haversine(a, b);
      if (segLen <= 0) { i++; continue; }
      if (remaining <= segLen) {
        const t = remaining / segLen;
        const targetLat = a.lat + t * (b.lat - a.lat);
        const targetLng = a.lng + t * (b.lng - a.lng);
        return bearing(origin, { lat: targetLat, lng: targetLng });
      }
      remaining -= segLen;
      i++;
    }
    // End of track reached
    const last = this._trackPoints[this._trackPoints.length - 1];
    return bearing(origin, { lat: last.lat, lng: last.lng });
  }

  // ---------------------------------------------------------------------------
  // State snapshot (for NavHUD component)
  // ---------------------------------------------------------------------------

  get state(): NavState {
    return {
      active:       this.active,
      trackId:      this.trackId,
      cpIdx:        this.cpIdx,
      distToNext:   this.distToNext,
      crossTrackErr: this.xte,
      bearingToNext: this.bearingToNext,
      nextLabel:    this.nextLabel,
      totalDist:    this.totalDist,
      coveredDist:  this.coveredDist,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _trackLengthM(points: GpxPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(
      { lat: points[i - 1].lat, lng: points[i - 1].lng },
      { lat: points[i].lat, lng: points[i].lng }
    ); // already meters (R=6371000)
  }
  return total;
}

function _partialLengthM(points: GpxPoint[], upToIdx: number): number {
  let total = 0;
  for (let i = 1; i <= upToIdx && i < points.length; i++) {
    total += haversine(
      { lat: points[i - 1].lat, lng: points[i - 1].lng },
      { lat: points[i].lat, lng: points[i].lng }
    ); // already meters (R=6371000)
  }
  return total;
}

export const navigationStore = new NavigationStore();
