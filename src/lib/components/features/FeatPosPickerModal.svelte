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

  let miniMap: HTMLDivElement;
  let lMap:          import('leaflet').Map | null = null;
  let crosshairLat = $state(editFeature?.lat ?? mapStore.gpsPos?.lat ?? 51.4192);
  let crosshairLng = $state(editFeature?.lng ?? mapStore.gpsPos?.lng ?? 7.4855);

  let selType     = $state<FeatureType>((editFeature?.type ?? 'drop') as FeatureType);
  let featName    = $state(editFeature?.name ?? '');
  let featDiff    = $state<1 | 2 | 3>(Math.max(1, Math.min(3, editFeature?.diff ?? 2)) as 1 | 2 | 3);
  let snapEnabled = $state(false);

  let _trackPts: GpxPoint[] = [];

  const FEAT_TYPES = Object.keys(FEAT_ICONS) as FeatureType[];

  const DIFF_LEVELS: Array<{ v: 1 | 2 | 3; l: string; c: string }> = [
    { v: 1, l: 'Beginner', c: '#22c55e' },
    { v: 2, l: 'Mittel',   c: '#f59e0b' },
    { v: 3, l: 'Expert',   c: '#ef4444' },
  ];

  onMount(async () => {
    _trackPts = tracksStore.getPointsForTrack(trackId);

    const L = await import('leaflet');
    lMap = L.map(miniMap, {
      center:      [crosshairLat, crosshairLng],
      zoom:        mapStore.map?.getZoom() ?? 16,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(lMap);

    lMap.on('moveend', () => {
      const c = lMap!.getCenter();
      if (snapEnabled && _trackPts.length >= 2) {
        const snp    = nearestPointOnTrack({ lat: c.lat, lng: c.lng }, _trackPts);
        crosshairLat = snp.lat;
        crosshairLng = snp.lng;
      } else {
        crosshairLat = c.lat;
        crosshairLng = c.lng;
      }
    });

    // When editing: fly to the existing feature position
    if (editFeature) {
      lMap.setView([editFeature.lat, editFeature.lng], 16);
    }
  });

  onDestroy(() => { lMap?.remove(); });

  function setToGpsPos() {
    if (!mapStore.gpsPos) { app.toast('Kein GPS-Fix', 'warn'); return; }
    crosshairLat = mapStore.gpsPos.lat;
    crosshairLng = mapStore.gpsPos.lng;
    lMap?.setView([crosshairLat, crosshairLng], lMap.getZoom());
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

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="fpp-overlay" role="dialog">
  <!-- Mini map -->
  <div class="fpp-map-wrap">
    <div bind:this={miniMap} style="width:100%;height:100%"></div>

    <!-- Crosshair icon -->
    <div class="fpp-crosshair">
      <div style="font-size:2rem;filter:drop-shadow(0 0 4px #000)">{FEAT_ICONS[selType]}</div>
    </div>

    <!-- Coords label -->
    <div class="fpp-coords">
      {crosshairLat.toFixed(5)}, {crosshairLng.toFixed(5)}
    </div>

    <!-- GPS + Snap overlay buttons -->
    <div class="fpp-tools">
      <button class="btn btn-secondary btn-sm" onclick={setToGpsPos}
        disabled={!mapStore.gpsPos} title="GPS-Position setzen">📍 GPS</button>
      <button
        class="btn btn-sm {snapEnabled ? 'btn-primary' : 'btn-secondary'}"
        onclick={() => snapEnabled = !snapEnabled}
        title="Auf Track einrasten"
      >🧲 Snap {snapEnabled ? 'AN' : 'AUS'}</button>
    </div>
  </div>

  <!-- Controls panel -->
  <div class="fpp-controls">
    <!-- Type chips -->
    <div style="display:flex;gap:0.3rem;overflow-x:auto;scrollbar-width:none;padding-bottom:0.1rem">
      {#each FEAT_TYPES as type}
        <button
          class="chip {selType === type ? 'active' : ''}"
          onclick={() => selType = type}
          style="flex-shrink:0"
          title={FEAT_NAMES[type]}
        >{FEAT_ICONS[type]}</button>
      {/each}
    </div>

    <div class="form-row">
      <label class="form-label" for="feat-name">Name</label>
      <input id="feat-name" class="input" type="text" bind:value={featName}
        placeholder={FEAT_NAMES[selType]} />
    </div>

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

    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-secondary flex-1" onclick={onclose}>Abbrechen</button>
      <button class="btn btn-primary flex-1" onclick={save}>
        {editFeature ? 'Aktualisieren' : 'Feature setzen'}
      </button>
    </div>
  </div>
</div>

<style>
  .fpp-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 450;
    display: flex; flex-direction: column;
  }
  .fpp-map-wrap {
    flex: 1; position: relative; overflow: hidden;
  }
  .fpp-crosshair {
    position: absolute; inset: 0; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
  }
  .fpp-coords {
    position: absolute; top: 0.5rem; left: 50%; transform: translateX(-50%);
    background: rgba(11,14,20,0.85);
    padding: 0.25rem 0.75rem; border-radius: 1rem;
    font-size: 0.75rem; color: var(--td);
    pointer-events: none; white-space: nowrap;
  }
  .fpp-tools {
    position: absolute; top: 0.5rem; right: 0.5rem;
    display: flex; flex-direction: column; gap: 0.3rem;
  }
  .fpp-controls {
    background: var(--s1);
    padding: 0.75rem 1rem;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
</style>
