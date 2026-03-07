// =============================================================================
// GMTW Trail Map — Map Store (Svelte 5 Runes)
//
// Leaflet-Instanz, Layer, Filter, GPS-Tracking, Tile Precaching
// =============================================================================

import { saveMapView, loadMapView, saveHomeRegion, loadHomeRegion, LS_KEYS, lsSet } from '$lib/services/storage';
import { enqueueTilePrefetch } from '$lib/services/sw-messenger';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '$lib/data/locs';
import { bearing, haversine } from '$lib/services/geo';
import type { LatLng } from '$lib/types';

// Re-export for use inside class methods that can't import at top level
export { DEFAULT_CENTER, DEFAULT_ZOOM };

// Leaflet wird als side-effect import eingebunden
// (kein tree-shaking Problem da CDN-Fallback existiert)
type LeafletMap = import('leaflet').Map;
type LeafletTileLayer = import('leaflet').TileLayer;

// Tile Layer URLs
const TILE_TOPO      = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const TILE_ATTRIBUTION_TOPO = '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)';
const TILE_ATTRIBUTION_SAT  = 'Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

// Filter categories
export type MapFilter = 'all' | 'beginner' | 'mittel' | 'expert' | 'optional-logistik' | 'custom';

// TPC debounce timer
let _tpcTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// MapStore class
// ---------------------------------------------------------------------------

class MapStore {
  map     = $state<LeafletMap | null>(null);
  tileLayer = $state<LeafletTileLayer | null>(null);
  layer   = $state<'topo' | 'satellite'>('topo');
  filter  = $state<MapFilter>('all');

  // GPS State
  gpsActive          = $state(false);
  gpsPos             = $state<LatLng | null>(null);
  gpsAccuracy        = $state(0);
  gpsHeading         = $state<number | null>(null);
  gpsMovementHeading = $state<number | null>(null); // bearing from prev→curr position
  gpsError           = $state<string | null>(null);
  gpsFix             = $state(false); // first fix received

  private _watchId:   number | null = null;
  private _wakeLock:  WakeLockSentinel | null = null;
  private _prevGpsPos: LatLng | null = null;

  // ---------------------------------------------------------------------------
  // Map Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialisiert die Leaflet-Karte in `container`.
   * Wird als Svelte-Action oder aus `onMount` aufgerufen.
   */
  async init(container: HTMLElement): Promise<void> {
    if (typeof window === 'undefined' || this.map) return;

    const L = await import('leaflet');

    const saved = loadMapView();
    const homeRegion = loadHomeRegion();

    const startLat  = saved?.lat  ?? homeRegion?.lat  ?? DEFAULT_CENTER[0];
    const startLng  = saved?.lng  ?? homeRegion?.lng  ?? DEFAULT_CENTER[1];
    const startZoom = saved?.zoom ?? DEFAULT_ZOOM;

    const map = L.map(container, {
      center: [startLat, startLng],
      zoom: startZoom,
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: 22,
    });

    // Tile Layer
    const isTopo = this.layer === 'topo';
    const tileUrl = isTopo ? TILE_TOPO : TILE_SATELLITE;
    const tileAttr = isTopo ? TILE_ATTRIBUTION_TOPO : TILE_ATTRIBUTION_SAT;
    const tl = L.tileLayer(tileUrl, {
      attribution: tileAttr,
      maxZoom: 22,
      maxNativeZoom: isTopo ? 17 : 19,
      keepBuffer: 4,
      updateWhenIdle: false,
      updateWhenZooming: false,
    });
    tl.addTo(map);

    this.map = map;
    this.tileLayer = tl;

    // Persist map view on move
    map.on('moveend zoomend', () => {
      const c = map.getCenter();
      saveMapView(c.lat, c.lng, map.getZoom());
      // Tile Precache
      this._scheduleTilePrecache();
    });
  }

  // ---------------------------------------------------------------------------
  // Layer Toggle
  // ---------------------------------------------------------------------------

  async toggleLayer(): Promise<void> {
    if (!this.map) return;
    const L = await import('leaflet');

    this.layer = this.layer === 'topo' ? 'satellite' : 'topo';
    const isTopo2 = this.layer === 'topo';
    const url  = isTopo2 ? TILE_TOPO : TILE_SATELLITE;
    const attr = isTopo2 ? TILE_ATTRIBUTION_TOPO : TILE_ATTRIBUTION_SAT;

    if (this.tileLayer) {
      this.map.removeLayer(this.tileLayer);
    }
    const newTl = L.tileLayer(url, {
      attribution: attr,
      maxZoom: 22,
      maxNativeZoom: isTopo2 ? 17 : 19,
      keepBuffer: 4,
      updateWhenIdle: false,
      updateWhenZooming: false,
    });
    newTl.addTo(this.map);
    this.tileLayer = newTl;
  }

  // ---------------------------------------------------------------------------
  // Filter
  // ---------------------------------------------------------------------------

  setFilter(f: MapFilter): void {
    this.filter = f;
  }

  // ---------------------------------------------------------------------------
  // GPS Tracking
  // ---------------------------------------------------------------------------

  startGps(): void {
    if (!navigator.geolocation || this.gpsActive) return;
    this.gpsActive = true;
    this.gpsError  = null;

    this._watchId = navigator.geolocation.watchPosition(
      (pos) => this._onGpsSuccess(pos),
      (err) => this._onGpsError(err),
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      }
    );

    // WakeLock
    this._acquireWakeLock();
  }

  stopGps(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this.gpsActive          = false;
    this.gpsPos             = null;
    this.gpsMovementHeading = null;
    this._prevGpsPos        = null;
    this._releaseWakeLock();
  }

  toggleGps(): void {
    if (this.gpsActive) this.stopGps();
    else this.startGps();
  }

  private _onGpsSuccess(pos: GeolocationPosition): void {
    const { latitude, longitude, accuracy, heading } = pos.coords;
    const curr: LatLng = { lat: latitude, lng: longitude };

    // Calculate movement heading from position delta (> 3m movement threshold)
    if (this._prevGpsPos) {
      const moved = haversine(this._prevGpsPos, curr);
      if (moved > 3) {
        this.gpsMovementHeading = bearing(this._prevGpsPos, curr);
        this._prevGpsPos = curr;
      }
    } else {
      this._prevGpsPos = curr;
    }

    this.gpsPos      = curr;
    this.gpsAccuracy = accuracy;
    this.gpsHeading  = heading;
    this.gpsError    = null;

    if (!this.gpsFix) {
      this.gpsFix = true;
      // Auto-pan to GPS position on first fix
      this.map?.flyTo([latitude, longitude], Math.max(this.map.getZoom(), 16), {
        animate: true,
        duration: 1,
      });
    }
  }

  private _onGpsError(err: GeolocationPositionError): void {
    this.gpsError = err.message;
  }

  private async _acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this._wakeLock = await (navigator as Navigator & {
          wakeLock: { request(type: string): Promise<WakeLockSentinel> }
        }).wakeLock.request('screen');
      }
    } catch {
      // WakeLock not supported or denied
    }
  }

  private _releaseWakeLock(): void {
    this._wakeLock?.release();
    this._wakeLock = null;
  }

  // ---------------------------------------------------------------------------
  // Fit All / Pan
  // ---------------------------------------------------------------------------

  panTo(lat: number, lng: number, zoom?: number): void {
    if (!this.map) return;
    if (zoom) this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.8 });
    else      this.map.panTo([lat, lng]);
  }

  flyTo(lat: number, lng: number, zoom = 17): void {
    this.map?.flyTo([lat, lng], zoom, { animate: true, duration: 1.2 });
  }

  fitBounds(bounds: import('leaflet').LatLngBoundsExpression, padding = 44): void {
    this.map?.fitBounds(bounds, { padding: [padding, padding], maxZoom: 17, animate: true });
  }

  fitAll(trackBounds: Array<import('leaflet').LatLngBoundsLiteral>): void {
    if (!this.map) return;
    if (trackBounds.length === 0) {
      // Fallback to default center
      this.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    // Merge all bounds
    import('leaflet').then(L => {
      if (!this.map) return;
      const initial = L.latLngBounds(trackBounds[0]);
      const merged = trackBounds.slice(1).reduce(
        (acc: import('leaflet').LatLngBounds, b) => acc.extend(b),
        initial
      );
      if (merged.isValid()) {
        this.map.fitBounds(merged, { padding: [44, 44], maxZoom: 17, animate: true });
      }
    });
  }

  setHomeRegion(): void {
    if (!this.map) return;
    const c = this.map.getCenter();
    saveHomeRegion(c.lat, c.lng);
    lsSet(LS_KEYS.VIEW, { lat: c.lat, lng: c.lng, zoom: this.map.getZoom() });
  }

  // ---------------------------------------------------------------------------
  // Tile Precache
  // ---------------------------------------------------------------------------

  private _scheduleTilePrecache(): void {
    if (_tpcTimer) clearTimeout(_tpcTimer);
    _tpcTimer = setTimeout(() => {
      requestIdleCallback?.(() => this._runTilePrecache()) ?? this._runTilePrecache();
    }, 1400);
  }

  private _runTilePrecache(): void {
    if (!this.map) return;
    const bounds = this.map.getBounds();
    const zoom   = this.map.getZoom();
    const center = this.map.getCenter();

    const tiles: Array<{ url: string; x: number; y: number; z: number }> = [];

    // ±2 zoom levels, ±1 on lower zoom
    for (const dz of [-1, 0, 1, 2]) {
      const z = Math.max(1, Math.min(18, zoom + dz));
      const nwTile = _latlngToTile(bounds.getNorth(), bounds.getWest(), z);
      const seTile = _latlngToTile(bounds.getSouth(), bounds.getEast(), z);
      const allTiles: Array<{ x: number; y: number; z: number }> = [];
      for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
          allTiles.push({ x, y, z });
        }
      }
      // Sort center-out
      const cx = _latlngToTile(center.lat, center.lng, z).x;
      const cy = _latlngToTile(center.lat, center.lng, z).y;
      allTiles.sort((a, b) =>
        Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)
      );
      for (const t of allTiles) {
        const url = TILE_TOPO
          .replace('{s}', 'a')
          .replace('{z}', String(t.z))
          .replace('{x}', String(t.x))
          .replace('{y}', String(t.y));
        tiles.push({ url, ...t });
      }
    }

    if (tiles.length > 0) {
      enqueueTilePrefetch(tiles.slice(0, 600));
    }
  }

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.stopGps();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}

/** Convert lat/lng to tile XY at zoom level z */
function _latlngToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export const mapStore = new MapStore();
