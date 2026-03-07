<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { FEAT_ICONS, FEAT_NAMES } from '$lib/types';
  import { nearestPointOnTrack } from '$lib/services/geo';
  import type { FeatureType, TrackFeature, GpxPoint } from '$lib/types';

  interface Props {
    trackId:      string;
    editFeature?: TrackFeature | null;
    onclose?:     () => void;
    onsave?:      (feat: TrackFeature) => void;
  }
  let { trackId, editFeature = null, onclose, onsave }: Props = $props();

  // Reactive state for UI
  let crosshairLat = $state(editFeature?.lat ?? mapStore.gpsPos?.lat ?? 51.4192);
  let crosshairLng = $state(editFeature?.lng ?? mapStore.gpsPos?.lng ?? 7.4855);
  let selType      = $state<FeatureType>((editFeature?.type ?? 'drop') as FeatureType);
  let featName     = $state(editFeature?.name ?? '');
  let featDiff     = $state<1 | 2 | 3>(Math.max(1, Math.min(3, editFeature?.diff ?? 2)) as 1 | 2 | 3);
  let snapEnabled  = $state(false);

  // Non-reactive Leaflet objects (MUST NOT be $state — Svelte proxy breaks Leaflet)
  let _marker:   import('leaflet').Marker | null = null;
  let _L:        typeof import('leaflet') | null = null;
  let _trackPts: GpxPoint[] = [];

  const FEAT_TYPES = Object.keys(FEAT_ICONS) as FeatureType[];

  const DIFF_LEVELS: Array<{ v: 1 | 2 | 3; l: string; c: string }> = [
    { v: 1, l: 'Beginner', c: '#22c55e' },
    { v: 2, l: 'Mittel',   c: '#f59e0b' },
    { v: 3, l: 'Expert',   c: '#ef4444' },
  ];

  function _createIcon(type: FeatureType) {
    if (!_L) return null;
    return _L.divIcon({
      className: '',
      html: `<div class="feat-drag-pin" style="font-size:2rem;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.9));user-select:none">${FEAT_ICONS[type]}</div>`,
      iconSize:   [40, 40],
      iconAnchor: [20, 40],
    });
  }

  // Update marker icon live when feature type changes
  $effect(() => {
    const icon = _createIcon(selType);
    if (icon) _marker?.setIcon(icon);
  });

  onMount(async () => {
    if (!mapStore.map) { app.toast('Karte nicht bereit', 'error'); return; }

    _trackPts = tracksStore.getPointsForTrack(trackId);
    _L = await import('leaflet');

    const initialIcon = _createIcon(selType)!;

    _marker = _L.marker([crosshairLat, crosshairLng], {
      draggable:    true,
      icon:         initialIcon,
      zIndexOffset: 900,
    }).addTo(mapStore.map);

    _marker.on('dragend', () => {
      const pos = _marker!.getLatLng();
      if (snapEnabled && _trackPts.length >= 2) {
        const snp    = nearestPointOnTrack({ lat: pos.lat, lng: pos.lng }, _trackPts);
        crosshairLat = snp.lat;
        crosshairLng = snp.lng;
        _marker!.setLatLng([snp.lat, snp.lng]);
      } else {
        crosshairLat = pos.lat;
        crosshairLng = pos.lng;
      }
    });

    // Zoom map to track, or to edit feature position
    const track = tracksStore.getTrack(trackId);
    if (track?.bounds) {
      mapStore.fitBounds([
        [track.bounds.south, track.bounds.west],
        [track.bounds.north, track.bounds.east],
      ]);
    } else if (editFeature) {
      mapStore.map.setView([editFeature.lat, editFeature.lng], 17);
    }
  });

  onDestroy(() => {
    if (_marker && mapStore.map) mapStore.map.removeLayer(_marker);
    _marker = null;
  });

  function setToGpsPos() {
    if (!mapStore.gpsPos) { app.toast('Kein GPS-Fix', 'warn'); return; }
    crosshairLat = mapStore.gpsPos.lat;
    crosshairLng = mapStore.gpsPos.lng;
    _marker?.setLatLng([crosshairLat, crosshairLng]);
    mapStore.map?.panTo([crosshairLat, crosshairLng]);
  }

  function save() {
    const feat: TrackFeature = {
      id:   editFeature?.id ?? `feat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: selType,
      name: featName || FEAT_NAMES[selType],
      diff: featDiff,
      date: editFeature?.date ?? Date.now(),
      lat:  crosshairLat,
      lng:  crosshairLng,
    };
    onsave?.(feat);
  }
</script>

<!-- Bottom-sheet — NO fullscreen overlay, map stays interactive -->
<div class="fpp-sheet" role="dialog">

  <!-- Drag hint + live coordinates -->
  <div class="fpp-hint">
    <span class="fpp-hint-icon">{FEAT_ICONS[selType]}</span>
    <span class="fpp-hint-text">Marker auf der Karte verschieben</span>
    <span class="fpp-coords">{crosshairLat.toFixed(5)}, {crosshairLng.toFixed(5)}</span>
  </div>

  <!-- Feature type chips -->
  <div class="fpp-scroll-row">
    {#each FEAT_TYPES as type}
      <button
        class="chip {selType === type ? 'active' : ''}"
        onclick={() => selType = type}
        style="flex-shrink:0"
        title={FEAT_NAMES[type]}
      >{FEAT_ICONS[type]}</button>
    {/each}
  </div>

  <!-- Name input -->
  <div class="form-row">
    <label class="form-label" for="fpp-name">Name</label>
    <input
      id="fpp-name" class="input" type="text"
      bind:value={featName}
      placeholder={FEAT_NAMES[selType]}
    />
  </div>

  <!-- Difficulty chips -->
  <div class="form-row">
    <label class="form-label">Schwierigkeit</label>
    <div style="display:flex;gap:0.4rem">
      {#each DIFF_LEVELS as d}
        <button
          class="chip {featDiff === d.v ? 'active' : ''}"
          style={featDiff === d.v
            ? `background:${d.c};color:#000;border-color:${d.c};font-weight:700`
            : ''}
          onclick={() => featDiff = d.v}
        >{d.l}</button>
      {/each}
    </div>
  </div>

  <!-- GPS + Snap row -->
  <div style="display:flex;gap:0.5rem">
    <button class="btn btn-secondary btn-sm flex-1"
      onclick={setToGpsPos}
      disabled={!mapStore.gpsPos}
    >📍 GPS</button>
    <button
      class="btn btn-sm flex-1 {snapEnabled ? 'btn-primary' : 'btn-secondary'}"
      onclick={() => snapEnabled = !snapEnabled}
    >🧲 Snap {snapEnabled ? 'AN' : 'AUS'}</button>
  </div>

  <!-- Cancel / Save -->
  <div style="display:flex;gap:0.5rem">
    <button class="btn btn-secondary flex-1" onclick={onclose}>Abbrechen</button>
    <button class="btn btn-primary flex-1" onclick={save}>
      {editFeature ? 'Aktualisieren' : 'Feature setzen'}
    </button>
  </div>
</div>

<style>
  .fpp-sheet {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: var(--s1);
    border-top: 2px solid var(--bd2);
    border-radius: 1rem 1rem 0 0;
    padding: 0.75rem 1rem 1rem;
    z-index: 450;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 55vh;
    overflow-y: auto;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.4);
  }

  .fpp-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--bd2);
    margin-bottom: 0.1rem;
  }
  .fpp-hint-icon { font-size: 1.2rem; flex-shrink: 0; }
  .fpp-hint-text { flex: 1; font-size: 0.82rem; color: var(--td); }
  .fpp-coords    { font-size: 0.72rem; color: var(--td); font-family: monospace; flex-shrink: 0; }

  .fpp-scroll-row {
    display: flex;
    gap: 0.3rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 0.1rem;
  }
  .fpp-scroll-row::-webkit-scrollbar { display: none; }
</style>
