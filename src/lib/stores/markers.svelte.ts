// =============================================================================
// GMTW Trail Map — Markers Store (Svelte 5 Runes)
//
// LOCS (17 predefined markers) + Custom Markers
// - LOCS: Overrides (Name, Emoji), Hidden-State, Scale, Category Filter
// - Custom: CRUD, Leaflet Layer Management
// =============================================================================

import { db, serializeMarker } from '$lib/services/database';
import { saveMarkerScale, loadMarkerScale, saveLocsOverride, resetLocsOverride, loadLocsOverrides } from '$lib/services/storage';
import { LOCS, DEFAULT_HIDDEN_LOCS } from '$lib/data/locs';
import { app } from './app.svelte';
import { projectsStore } from './projects.svelte';
import { mapStore } from './map.svelte';
import type { LocMarker, CustomMarker, LocsOverride } from '$lib/types';

// ---------------------------------------------------------------------------
// MarkersStore class
// ---------------------------------------------------------------------------

class MarkersStore {
  locs         = $state<LocMarker[]>([...LOCS]);
  custom       = $state<CustomMarker[]>([]);
  locsOverrides = $state<Record<string, LocsOverride>>({});
  markerScale  = $state(1.0);
  loading      = $state(false);

  // Selected LOCS marker for info card
  selectedLoc           = $state<LocMarker | null>(null);
  // Selected custom marker (click on map → opens detail/edit sheet)
  selectedCustomMarker  = $state<CustomMarker | null>(null);

  // Derived: visible custom markers (from enabled projects)
  visibleCustom = $derived(
    this.custom.filter(m => {
      const proj = projectsStore.projects.find(p => p.id === m.projectId);
      return proj && proj.enabled !== false;
    })
  );

  visibleLocs = $derived(
    this.locs.filter(l => !l._hidden)
  );

  activeProjectCustom = $derived(
    this.custom.filter(m => m.projectId === projectsStore.activeProjectId)
  );

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.loading = true;
    try {
      // Load custom markers
      this.custom = await db.customMarkers.toArray();
      // Load LOCS overrides
      this.locsOverrides = await loadLocsOverrides();
      // Apply default-hidden markers (only if user hasn't explicitly overridden)
      for (const id of DEFAULT_HIDDEN_LOCS) {
        if (!(id in this.locsOverrides)) {
          this.locsOverrides = { ...this.locsOverrides, [id]: { id, isHidden: true } };
        }
      }
      // Load marker scale
      this.markerScale = loadMarkerScale();
      // Apply overrides to LOCS
      this._applyLocsOverrides();
    } finally {
      this.loading = false;
    }
  }

  private _applyLocsOverrides(): void {
    this.locs = LOCS.map(loc => {
      const ov = this.locsOverrides[loc.id];
      if (!ov) return { ...loc };
      return {
        ...loc,
        _overrideName:  ov.name,
        _overrideEmoji: ov.emoji,
        _hidden:        ov.isHidden ?? false,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // LOCS Selection (info card)
  // ---------------------------------------------------------------------------

  clearLocSelection(): void {
    this.selectedLoc = null;
  }

  clearCustomSelection(): void {
    this.selectedCustomMarker = null;
  }

  // ---------------------------------------------------------------------------
  // LOCS Management
  // ---------------------------------------------------------------------------

  async updateLocsMarker(id: string, name?: string, emoji?: string): Promise<void> {
    const override: LocsOverride = {
      id,
      name:     name,
      emoji:    emoji,
      isHidden: this.locsOverrides[id]?.isHidden ?? false,
    };
    await saveLocsOverride(id, override);
    this.locsOverrides = { ...this.locsOverrides, [id]: override };
    this._applyLocsOverrides();
    await this.renderLocsOnMap(mapStore.filter);
  }

  async resetLocsMarker(id: string): Promise<void> {
    await resetLocsOverride(id);
    const { [id]: _, ...rest } = this.locsOverrides;
    void _;
    this.locsOverrides = rest;
    this._applyLocsOverrides();
    await this.renderLocsOnMap(mapStore.filter);
    app.toast('Marker zurückgesetzt', 'info');
  }

  async toggleLocsVisibility(id: string): Promise<void> {
    const current = this.locsOverrides[id]?.isHidden ?? false;
    const override: LocsOverride = {
      ...this.locsOverrides[id],
      id,
      isHidden: !current,
    };
    await saveLocsOverride(id, override);
    this.locsOverrides = { ...this.locsOverrides, [id]: override };
    this._applyLocsOverrides();
    await this.renderLocsOnMap(mapStore.filter);
  }

  // ---------------------------------------------------------------------------
  // Marker Scale
  // ---------------------------------------------------------------------------

  async setMarkerScale(scale: number): Promise<void> {
    this.markerScale = Math.max(0.5, Math.min(2.0, scale));
    saveMarkerScale(this.markerScale);
    if (mapStore.map) {
      // Remove all existing custom markers from map first
      for (const m of this.custom) {
        this._removeCustomMarkerFromMap(m);
      }
      // Re-render with new scale
      await this.renderLocsOnMap(mapStore.filter);
      await this.renderAllCustomOnMap();
    }
  }

  // ---------------------------------------------------------------------------
  // Custom Marker CRUD
  // ---------------------------------------------------------------------------

  async addCustomMarker(
    data: Omit<CustomMarker, 'id' | 'createdAt' | 'projectId'> & { projectId?: string }
  ): Promise<CustomMarker> {
    const marker: CustomMarker = {
      ...data,
      id:        `cm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      projectId: data.projectId ?? projectsStore.activeProjectId ?? 'default',
      createdAt: Date.now(),
    };
    await db.customMarkers.put(serializeMarker(marker));
    this.custom = [...this.custom, marker];
    await this._renderCustomMarkerOnMap(marker);
    app.toast(`Marker "${marker.name}" erstellt`, 'success');
    return marker;
  }

  async updateCustomMarker(id: string, changes: Partial<CustomMarker>): Promise<void> {
    const m = this.custom.find(m => m.id === id);
    if (!m) return;
    Object.assign(m, changes);
    await db.customMarkers.put(serializeMarker(m));
    this.custom = [...this.custom];
    // Re-render
    this._removeCustomMarkerFromMap(m);
    await this._renderCustomMarkerOnMap(m);
  }

  async deleteCustomMarker(id: string): Promise<void> {
    const m = this.custom.find(m => m.id === id);
    if (m) this._removeCustomMarkerFromMap(m);
    await db.customMarkers.delete(id);
    this.custom = this.custom.filter(m => m.id !== id);
    app.toast('Marker gelöscht', 'info');
  }

  getCustomMarker(id: string): CustomMarker | undefined {
    return this.custom.find(m => m.id === id);
  }

  // ---------------------------------------------------------------------------
  // Map Rendering — LOCS
  // ---------------------------------------------------------------------------

  async renderLocsOnMap(filter: string = 'all'): Promise<void> {
    if (!mapStore.map) return;
    const L = await import('leaflet');

    // Remove existing LOCS layers
    for (const loc of this.locs) {
      if (loc._layer) {
        mapStore.map.removeLayer(loc._layer as import('leaflet').Layer);
        loc._layer = undefined;
      }
    }

    for (const loc of this.locs) {
      if (loc._hidden) continue;
      // Category filter: hide if not matching (except 'all')
      if (filter !== 'all' && loc.cat !== filter) continue;

      const name  = loc._overrideName ?? (loc.nameI18n?.[app.lang] ?? loc.name);
      const emoji = loc._overrideEmoji ?? loc.emoji;
      const scale = this.markerScale;
      const size  = Math.round(32 * scale);

      const icon = L.divIcon({
        className: 'locs-marker',
        html: `
          <div class="locs-pin" style="
            background:${loc.color};
            width:${size}px;height:${size}px;
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            border:2px solid rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
          ">
            <span style="transform:rotate(45deg);font-size:${Math.round(size * 0.55)}px;line-height:1">${emoji}</span>
          </div>`,
        iconSize:   [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size],
      });

      // Capture loc reference for click handler
      const locRef = loc;
      const m = L.marker([loc.lat, loc.lng], { icon })
        .addTo(mapStore.map);
      m.on('click', () => { if (!app.featurePlacement) this.selectedLoc = locRef; });
      loc._layer = m;
    }
  }

  // ---------------------------------------------------------------------------
  // Map Rendering — Custom Markers
  // ---------------------------------------------------------------------------

  async renderAllCustomOnMap(): Promise<void> {
    for (const m of this.custom) {
      await this._renderCustomMarkerOnMap(m);
    }
  }

  private async _renderCustomMarkerOnMap(marker: CustomMarker): Promise<void> {
    if (!mapStore.map) return;
    const L = await import('leaflet');

    const proj = projectsStore.projects.find(p => p.id === marker.projectId);
    if (proj && proj.enabled === false) return;

    const scale = this.markerScale;
    const size  = Math.round(36 * scale);

    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div class="cm-pin" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.6)}px;display:flex;align-items:center;justify-content:center;background:var(--s2);border-radius:50%;border:2px solid var(--ac)">${marker.emoji}</div>`,
      iconSize:   [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const markerRef = marker;
    const m = L.marker([marker.lat, marker.lng], { icon })
      .addTo(mapStore.map);
    m.on('click', () => { if (!app.featurePlacement) this.selectedCustomMarker = markerRef; });
    marker._layer = m;
  }

  private _removeCustomMarkerFromMap(marker: CustomMarker): void {
    if (marker._layer && mapStore.map) {
      mapStore.map.removeLayer(marker._layer as import('leaflet').Layer);
      marker._layer = undefined;
    }
  }

  removeProjectMarkersFromMap(projectId: string): void {
    for (const m of this.custom.filter(m => m.projectId === projectId)) {
      this._removeCustomMarkerFromMap(m);
    }
  }

  async showProjectMarkersOnMap(projectId: string): Promise<void> {
    const projectMarkers = this.custom.filter(m => m.projectId === projectId);
    for (const m of projectMarkers) {
      await this._renderCustomMarkerOnMap(m);
    }
  }

  // ---------------------------------------------------------------------------
  // GMaps URL Helper
  // ---------------------------------------------------------------------------

  buildMapsUrl(lat: number, lng: number): string {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIos) return `maps://maps.apple.com/?q=${lat},${lng}`;
    return `https://maps.google.com/?q=${lat},${lng}`;
  }
}

export const markersStore = new MarkersStore();
