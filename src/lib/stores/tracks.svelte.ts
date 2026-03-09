// =============================================================================
// GMTW Trail Map — Tracks Store (Svelte 5 Runes)
//
// GPX-Tracks: Laden, Anzeigen, Filtern, Features/Ratings/Edits,
//             GitHub-Autodownload, Marker-Popups mit Aktion-Callbacks
// =============================================================================

import { db, serializeTrack, type TrackMeta } from '$lib/services/database';
import { parseGpx, calcStats, calcBounds, buildGpxString, injectFeaturesIntoGpx, parseFeaturesFromGpx } from '$lib/services/gpx';
import { haversineM } from '$lib/services/geo';
import { app } from './app.svelte';
import { projectsStore } from './projects.svelte';
import { mapStore } from './map.svelte';
import { markersStore } from './markers.svelte';
import { FEAT_ICONS } from '$lib/types';
import type { GmtwTrack, TrackCat, TrackCondition, TrackFeature, TrackEdit, GpxPoint } from '$lib/types';

// ---------------------------------------------------------------------------
// GitHub Repo — Auto-Download Konfiguration
// ---------------------------------------------------------------------------

export const REPO_RAW_BASE = 'https://raw.githubusercontent.com/Munimap/munimap.github.io/main/gpx/';
export const REPO_API_URL  = 'https://api.github.com/repos/Munimap/munimap.github.io/contents/gpx';

export const AUTO_TRACKS: Array<{ name: string; cat: TrackCat; file: string }> = [
  { name: 'GMTW 2026 Beginner',        cat: 'beginner', file: 'GMTW2026_Beginner.gpx'              },
  { name: 'GMTW 2026 Beginner/Mittel', cat: 'mittel',   file: 'GMTW2026_Beginner_Intermediate.gpx' },
  { name: 'GMTW 2026 Expert 1',        cat: 'expert',   file: 'GMTW2026_Expert_1.gpx'              },
  { name: 'GMTW 2026 Expert 2',        cat: 'expert',   file: 'GMTW2026_Expert_2.gpx'              },
  { name: 'GMTW 2026 Expert 3',        cat: 'expert',   file: 'GMTW2026_Expert_3.gpx'              },
  { name: 'GMTW 2026 Mittel',          cat: 'mittel',   file: 'GMTW2026_Intermediate.gpx'          },
];

// ---------------------------------------------------------------------------
// Non-reactive Leaflet layer bundle (stored outside $state to avoid proxy issues)
// ---------------------------------------------------------------------------

interface LayerBundle {
  poly:           import('leaflet').Polyline;
  startMkr?:      import('leaflet').Marker;
  finishMkr?:     import('leaflet').Marker;
  featureMarkers: import('leaflet').Marker[];
}

// ---------------------------------------------------------------------------
// TracksStore class
// ---------------------------------------------------------------------------

class TracksStore {
  tracks  = $state<GmtwTrack[]>([]);
  loading = $state(false);
  autoDownloading = $state(false);
  autoDownloadProgress = $state(0);

  // Non-reactive layer registry — Leaflet objects must NOT be inside $state
  private readonly _layers = new Map<string, LayerBundle>();

  // Selected track for info panel / race
  selectedTrackId   = $state<string | null>(null);
  selectedTrackType = $state<'start' | 'finish' | null>(null);

  // Derived: only visible tracks from enabled projects
  visibleTracks = $derived(
    this.tracks.filter(t => {
      const proj = projectsStore.projects.find(p => p.id === t.projectId);
      return t.visible && proj && proj.enabled !== false;
    })
  );

  activeProjectTracks = $derived(
    this.tracks.filter(t => t.projectId === projectsStore.activeProjectId)
  );

  selectedTrack = $derived(
    this.tracks.find(t => t.id === this.selectedTrackId) ?? null
  );

  // Track meta cache (features, ratings, edits per trackId)
  private _metaCache = $state<Record<string, TrackMeta>>({});

  // ---------------------------------------------------------------------------
  // Init / Load
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.loading = true;
    try {
      const all = await db.tracks.toArray();
      this.tracks = all;
      const metas = await db.trackMeta.toArray();
      const cache: Record<string, TrackMeta> = {};
      for (const m of metas) cache[m.trackId] = m;

      // Migrate features without id (introduced in v2 — run once, fire-and-forget)
      for (const meta of Object.values(cache)) {
        let changed = false;
        meta.features = meta.features.map(f => {
          if (!f.id) {
            changed = true;
            return { ...f, id: `feat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
          }
          return f;
        });
        if (changed) db.trackMeta.put(meta);
      }

      this._metaCache = cache;
    } finally {
      this.loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub Auto-Download
  // ---------------------------------------------------------------------------

  async autoDownloadTracks(force = false): Promise<number> {
    this.autoDownloading = true;
    this.autoDownloadProgress = 0;
    let downloaded = 0;

    try {
      const projectId = projectsStore.activeProjectId ?? projectsStore.projects[0]?.id ?? 'default';

      for (let i = 0; i < AUTO_TRACKS.length; i++) {
        const def = AUTO_TRACKS[i];
        this.autoDownloadProgress = Math.round((i / AUTO_TRACKS.length) * 100);

        const url = REPO_RAW_BASE + def.file;
        // Robust dedup: check sourceUrl first (most reliable), fallback to name
        if (!force && this.tracks.some(t => t.sourceUrl === url || t.name === def.name)) continue;

        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const gpxStr = await resp.text();
          await this.loadGpxString(gpxStr, def.name, def.cat, projectId, true /* silent */, url);
          downloaded++;
        } catch {
          // Network error — skip silently
        }
      }

      if (downloaded > 0) {
        app.toast(`✅ ${downloaded} Strecken geladen`, 'success');
      } else if (force) {
        app.toast('Alle Strecken bereits aktuell', 'info');
      }
    } finally {
      this.autoDownloading = false;
      this.autoDownloadProgress = 100;
    }
    return downloaded;
  }

  async checkGitHubForNewTracks(): Promise<void> {
    try {
      const resp = await fetch(REPO_API_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!resp.ok) throw new Error(`GitHub API: HTTP ${resp.status}`);
      const files = await resp.json() as Array<{ name: string; download_url: string }>;
      const gpxFiles = files.filter(f => f.name.toLowerCase().endsWith('.gpx'));

      let newCount = 0;
      const projectId = projectsStore.activeProjectId ?? 'default';
      for (const f of gpxFiles) {
        const basename = f.name.replace(/\.gpx$/i, '');
        // Robust dedup: check sourceUrl first, then name
        if (this.tracks.some(t => t.sourceUrl === f.download_url || t.name === basename)) continue;
        try {
          const r = await fetch(f.download_url);
          if (!r.ok) continue;
          const gpxStr = await r.text();
          const name   = basename;
          // Detect category from filename
          const cat = _detectCat(f.name);
          await this.loadGpxString(gpxStr, name, cat, projectId, true, f.download_url);
          newCount++;
        } catch { /* skip */ }
      }
      if (newCount > 0) app.toast(`✅ ${newCount} neue Strecken vom GitHub geladen`, 'success');
      else app.toast('Keine neuen Strecken', 'info');
    } catch (e) {
      app.toast(`GitHub-Fehler: ${e}`, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Load GPX from string
  // ---------------------------------------------------------------------------

  async loadGpxString(
    gpxStr: string,
    name: string,
    cat: TrackCat = 'custom',
    projectId?: string,
    silent = false,
    sourceUrl?: string
  ): Promise<GmtwTrack> {
    const parsed = parseGpx(gpxStr);
    const stats  = parsed.stats;
    const bounds = parsed.bounds;

    const track: GmtwTrack = {
      id:        `trk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name:      name || parsed.name || 'Track',
      cat,
      color:     _catColor(cat),
      gpxString: gpxStr,
      stats,
      visible:   true,
      projectId: projectId ?? projectsStore.activeProjectId ?? 'default',
      createdAt: Date.now(),
      bounds,
      sourceUrl,
    };

    await db.tracks.put(serializeTrack(track));
    this.tracks = [...this.tracks, track];

    if (!silent) {
      app.toast(`Track "${track.name}" geladen`, 'success');
    }
    return track;
  }

  // ---------------------------------------------------------------------------
  // Load GPX from URL
  // ---------------------------------------------------------------------------

  async loadGpxUrl(url: string, name?: string, cat?: TrackCat): Promise<GmtwTrack | null> {
    // Auto-correct GitHub blob URL to raw URL
    let finalUrl = url;
    if (url.includes('github.com') && url.includes('/blob/')) {
      finalUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      app.toast('ℹ️ GitHub-URL → Raw-URL umgewandelt', 'info');
    }
    try {
      const resp = await fetch(finalUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const gpxStr = await resp.text();
      return await this.loadGpxString(
        gpxStr,
        name ?? finalUrl.split('/').pop()?.replace(/\.gpx$/i, '') ?? 'Track',
        cat,
        undefined,
        false,
        finalUrl
      );
    } catch (err) {
      app.toast(`GPX-Ladefehler: ${err}`, 'error');
      return null;
    }
  }

  /** Returns true if a Leaflet polyline exists for this track id */
  hasLayer(trackId: string): boolean {
    return this._layers.has(trackId);
  }

  // ---------------------------------------------------------------------------
  // Toggle Visibility
  // ---------------------------------------------------------------------------

  async toggleTrack(id: string): Promise<void> {
    const t = this.tracks.find(t => t.id === id);
    if (!t) return;
    t.visible = !t.visible;
    await db.tracks.update(id, { visible: t.visible });
    this.tracks = [...this.tracks];

    // Update map layer
    if (t.visible && mapStore.map) {
      await this.renderTrackOnMap(t);
    } else if (!t.visible) {
      this.removeTrackFromMap(t);
    }
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  async removeTrack(id: string): Promise<void> {
    if (mapStore.map) this._removeLayerBundle(id, mapStore.map);
    await db.tracks.delete(id);
    await db.trackMeta.delete(id);
    this.tracks = this.tracks.filter(t => t.id !== id);
    const { [id]: _, ...rest } = this._metaCache;
    void _;
    this._metaCache = rest;
    if (this.selectedTrackId === id) this.selectedTrackId = null;
    app.toast('Track gelöscht', 'info');
  }

  // ---------------------------------------------------------------------------
  // Rename / Update Category
  // ---------------------------------------------------------------------------

  async renameTrack(id: string, name: string): Promise<void> {
    const t = this.tracks.find(t => t.id === id);
    if (!t) return;
    const edit: TrackEdit = { type: 'rename', newVal: name, oldVal: t.name, name: 'Umbenennung', date: Date.now() };
    t.name = name;
    await db.tracks.update(id, { name });
    await this.addEdit(id, edit);
    this.tracks = [...this.tracks];
  }

  async setCat(id: string, cat: TrackCat): Promise<void> {
    const t = this.tracks.find(t => t.id === id);
    if (!t) return;
    const edit: TrackEdit = { type: 'cat', newVal: cat, oldVal: t.cat, name: 'Kategorie', date: Date.now() };
    t.cat   = cat;
    t.color = _catColor(cat);
    await db.tracks.update(id, { cat, color: t.color });
    await this.addEdit(id, edit);
    this.tracks = [...this.tracks];
  }

  // ---------------------------------------------------------------------------
  // Track Selection (for info panel)
  // ---------------------------------------------------------------------------

  selectTrack(id: string, type: 'start' | 'finish' = 'start'): void {
    this.selectedTrackId   = id;
    this.selectedTrackType = type;
  }

  clearSelection(): void {
    this.selectedTrackId   = null;
    this.selectedTrackType = null;
  }

  // ---------------------------------------------------------------------------
  // Track Meta: Features
  // ---------------------------------------------------------------------------

  getFeatures(trackId: string): TrackFeature[] {
    return this._metaCache[trackId]?.features ?? [];
  }

  async addFeature(trackId: string, feature: TrackFeature): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    // Auto-assign id if missing
    const withId: TrackFeature = feature.id
      ? feature
      : { ...feature, id: `feat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    meta.features = [...meta.features, withId];
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
  }

  async removeFeature(trackId: string, featureId: string): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    meta.features = meta.features.filter(f => f.id !== featureId);
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
  }

  async updateFeature(
    trackId: string,
    featureId: string,
    changes: Partial<Omit<TrackFeature, 'id'>>
  ): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    meta.features = meta.features.map(f =>
      f.id === featureId ? { ...f, ...changes } : f
    );
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
  }

  // ---------------------------------------------------------------------------
  // Track Meta: Ratings
  // ---------------------------------------------------------------------------

  getRating(trackId: string): number {
    return this._metaCache[trackId]?.rating ?? 0;
  }

  async setRating(trackId: string, stars: number): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    meta.rating = Math.max(0, Math.min(5, stars));
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
  }

  // ---------------------------------------------------------------------------
  // Track Meta: Edits
  // ---------------------------------------------------------------------------

  getEdits(trackId: string): TrackEdit[] {
    return this._metaCache[trackId]?.edits ?? [];
  }

  async addEdit(trackId: string, edit: TrackEdit): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    meta.edits = [edit, ...meta.edits].slice(0, 50);
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
  }

  // ---------------------------------------------------------------------------
  // Track Meta: Description
  // ---------------------------------------------------------------------------

  getDescription(trackId: string): string {
    return this._metaCache[trackId]?.description ?? '';
  }

  async setDescription(trackId: string, desc: string): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    const old  = meta.description ?? '';
    const trimmed = desc.slice(0, 400);
    if (trimmed === old) return; // unchanged — skip write
    meta.description = trimmed;
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
    const edit: TrackEdit = { type: 'description', newVal: trimmed, oldVal: old, name: 'Beschreibung', date: Date.now() };
    await this.addEdit(trackId, edit);
  }

  // ---------------------------------------------------------------------------
  // Track Meta: Condition (Streckenzustand)
  // ---------------------------------------------------------------------------

  getCondition(trackId: string): TrackCondition {
    return this._metaCache[trackId]?.condition ?? 'unknown';
  }

  async setCondition(trackId: string, cond: TrackCondition): Promise<void> {
    const meta = await this._ensureMeta(trackId);
    const old  = meta.condition ?? 'unknown';
    if (cond === old) return;
    meta.condition = cond;
    await db.trackMeta.put(meta);
    this._metaCache = { ...this._metaCache, [trackId]: meta };
    const condLabels: Record<TrackCondition, string> = { dry: '🌞 Trocken', muddy: '💧 Schlammig', icy: '🧊 Eisig', unknown: '❓ Unbekannt' };
    const edit: TrackEdit = { type: 'condition', newVal: condLabels[cond], oldVal: condLabels[old], name: 'Zustand', date: Date.now() };
    await this.addEdit(trackId, edit);
  }

  // ---------------------------------------------------------------------------
  // GPX Export with Features
  // ---------------------------------------------------------------------------

  async getGpxWithFeatures(trackId: string): Promise<string | null> {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return null;
    const features = this.getFeatures(trackId);
    if (features.length === 0) return track.gpxString;
    return injectFeaturesIntoGpx(track.gpxString, features);
  }

  // ---------------------------------------------------------------------------
  // Leaflet Layer Management
  // ---------------------------------------------------------------------------

  async renderTrackOnMap(track: GmtwTrack): Promise<void> {
    if (!mapStore.map || !track.visible) return;
    const map = mapStore.map;
    const L   = await import('leaflet');

    // Remove existing layers for this track (avoids duplicates)
    this._removeLayerBundle(track.id, map);

    const parsed  = parseGpx(track.gpxString);
    const latlngs = parsed.points.map(p => [p.lat, p.lng] as [number, number]);
    if (latlngs.length === 0) return;

    // Main polyline — stored in non-reactive _layers Map
    const poly = L.polyline(latlngs, {
      color:     track.color,
      weight:    3.5,
      opacity:   0.85,
      lineCap:   'round',
      lineJoin:  'round',
    });
    poly.addTo(map);

    const bundle: LayerBundle = { poly, featureMarkers: [] };

    // Start marker
    if (latlngs.length > 0) {
      const w = 26, h = 32;
      const html = `<div class="start-pin" style="width:${w}px;height:${h}px;background:${track.color}" title="Start: ${_esc(track.name)}">` +
                   `<span class="start-pin-flag" style="font-size:13px">▶</span></div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: [w / 2, h] });
      const startMkr = L.marker(latlngs[0], { icon, zIndexOffset: 800, title: `Start: ${track.name}` })
        .bindTooltip(track.name, { permanent: true, direction: 'bottom', offset: [0, 4], className: 'map-label' });
      startMkr.on('click', () => { this.selectedTrackId = track.id; this.selectedTrackType = 'start'; });
      startMkr.addTo(map);
      bundle.startMkr = startMkr;
    }

    // Finish marker — skip for loop tracks (start ≈ finish < 30 m)
    if (latlngs.length >= 2) {
      const pts  = parsed.points;
      const dist = pts.length > 1 ? haversineM(pts[0].lat, pts[0].lng, pts[pts.length-1].lat, pts[pts.length-1].lng) : 0;
      if (dist >= 30) {
        const last = latlngs[latlngs.length - 1];
        const w = 26, h = 32;
        const html = `<div class="finish-pin" style="width:${w}px;height:${h}px;border-color:${track.color}" title="Ziel: ${_esc(track.name)}">` +
                     `<span class="finish-pin-flag" style="font-size:13px">🏁</span></div>`;
        const icon = L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: [w / 2, h] });
        const finishMkr = L.marker(last, { icon, zIndexOffset: 799, title: `Ziel: ${track.name}` });
        finishMkr.on('click', () => { this.selectedTrackId = track.id; this.selectedTrackType = 'finish'; });
        finishMkr.addTo(map);
        bundle.finishMkr = finishMkr;
      }
    }

    // Feature markers — half-size of regular markers (16*scale), neon accent border
    const features = this.getFeatures(track.id);
    const featScale = markersStore.markerScale;
    const featSize  = Math.max(14, Math.round(16 * featScale)); // half of LOCS 32*scale
    const featFont  = Math.max(0.5, featSize * 0.055);
    for (const f of features) {
      const icon = FEAT_ICONS[f.type] ?? '📍';
      const divIcon = L.divIcon({
        className: '',
        html: `<div style="font-size:${featFont}rem;background:rgba(10,14,20,0.85);border:1.5px solid #c8ff00;border-radius:50%;width:${featSize}px;height:${featSize}px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 6px rgba(0,0,0,0.6);pointer-events:auto">${icon}</div>`,
        iconSize:  [featSize, featSize],
        iconAnchor:[featSize / 2, featSize / 2],
      });
      const m = L.marker([f.lat, f.lng], { icon: divIcon })
        .bindTooltip(`${icon} ${f.name || f.type}`, { direction: 'top', offset: [0, -(featSize / 2 + 2)] })
        .addTo(map);
      bundle.featureMarkers.push(m);
    }

    // Store in non-reactive Map (no $state involved)
    this._layers.set(track.id, bundle);
  }

  async renderFeatureMarkersOnMap(track: GmtwTrack): Promise<void> {
    if (!mapStore.map) return;
    const map = mapStore.map;
    const L   = await import('leaflet');
    const features = this.getFeatures(track.id);

    // Remove existing feature markers
    const bundle = this._layers.get(track.id);
    if (bundle) {
      for (const m of bundle.featureMarkers) map.removeLayer(m);
      bundle.featureMarkers = [];
    }

    const featScale = markersStore.markerScale;
    const featSize  = Math.max(14, Math.round(16 * featScale));
    const featFont  = Math.max(0.5, featSize * 0.055);
    const newMarkers: import('leaflet').Marker[] = [];
    for (const f of features) {
      const icon = FEAT_ICONS[f.type] ?? '📍';
      const divIcon = L.divIcon({
        className: '',
        html: `<div style="font-size:${featFont}rem;background:rgba(10,14,20,0.85);border:1.5px solid #c8ff00;border-radius:50%;width:${featSize}px;height:${featSize}px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 6px rgba(0,0,0,0.6);pointer-events:auto">${icon}</div>`,
        iconSize:  [featSize, featSize],
        iconAnchor:[featSize / 2, featSize / 2],
      });
      const m = L.marker([f.lat, f.lng], { icon: divIcon })
        .bindTooltip(`${icon} ${f.name || f.type}`, { direction: 'top', offset: [0, -(featSize / 2 + 2)] })
        .addTo(map);
      newMarkers.push(m);
    }

    if (bundle) {
      bundle.featureMarkers = newMarkers;
    }
  }

  removeTrackFromMap(track: GmtwTrack): void {
    if (!mapStore.map) return;
    this._removeLayerBundle(track.id, mapStore.map);
  }

  private _removeLayerBundle(trackId: string, map: import('leaflet').Map): void {
    const bundle = this._layers.get(trackId);
    if (!bundle) return;
    map.removeLayer(bundle.poly);
    if (bundle.startMkr)  map.removeLayer(bundle.startMkr);
    if (bundle.finishMkr) map.removeLayer(bundle.finishMkr);
    for (const m of bundle.featureMarkers) map.removeLayer(m);
    this._layers.delete(trackId);
  }

  async renderAllTracks(): Promise<void> {
    for (const track of this.tracks) {
      if (track.visible) {
        await this.renderTrackOnMap(track);
      }
    }
  }

  // Fit map to all visible tracks
  fitAllTracks(): void {
    const bounds = this.tracks
      .filter(t => t.visible && t.bounds)
      .map(t => [[t.bounds!.south, t.bounds!.west], [t.bounds!.north, t.bounds!.east]] as import('leaflet').LatLngBoundsLiteral);
    if (bounds.length === 0) return;
    mapStore.fitAll(bounds);
  }

  // Get start point of track
  getStartPoint(trackId: string): GpxPoint | null {
    const t = this.getTrack(trackId);
    if (!t) return null;
    const pts = parseGpx(t.gpxString).points;
    return pts.length > 0 ? pts[0] : null;
  }

  // Get finish point of track
  getFinishPoint(trackId: string): GpxPoint | null {
    const t = this.getTrack(trackId);
    if (!t) return null;
    const pts = parseGpx(t.gpxString).points;
    return pts.length > 0 ? pts[pts.length - 1] : null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async _ensureMeta(trackId: string): Promise<TrackMeta> {
    if (this._metaCache[trackId]) return { ...this._metaCache[trackId] };
    const existing = await db.trackMeta.get(trackId);
    if (existing) {
      this._metaCache = { ...this._metaCache, [trackId]: existing };
      return { ...existing };
    }
    return { trackId, features: [], edits: [] };
  }

  getTrack(id: string): GmtwTrack | undefined {
    return this.tracks.find(t => t.id === id);
  }

  getPointsForTrack(id: string): GpxPoint[] {
    const t = this.getTrack(id);
    if (!t) return [];
    return parseGpx(t.gpxString).points;
  }
}

function _catColor(cat: TrackCat): string {
  const colors: Record<string, string> = {
    beginner:          '#27AE60',
    mittel:            '#D4A017',
    expert:            '#ef4444',
    'optional-logistik': '#38bdf8',
    custom:            '#a855f7',
  };
  return colors[cat] ?? '#a855f7';
}

function _detectCat(filename: string): TrackCat {
  const low = filename.toLowerCase();
  if (low.includes('beginner'))   return 'beginner';
  if (low.includes('intermediate') || low.includes('mittel')) return 'mittel';
  if (low.includes('expert'))     return 'expert';
  return 'custom';
}

function _esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export const tracksStore = new TracksStore();
