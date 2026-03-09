<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { recordingStore } from '$lib/stores/recording.svelte';

  interface Props {
    onOpenGpx:    () => void;
    onOpenQr:     () => void;
    onFitAll:     () => void;
    onOpenMarker: () => void;
  }
  let { onOpenGpx, onOpenQr, onFitAll, onOpenMarker }: Props = $props();

  // Hidden file input for GPX import
  let gpxInput: HTMLInputElement;

  async function handleGpxFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    await tracksStore.loadGpxString(text, file.name.replace(/\.gpx$/i, ''), 'custom');
    input.value = '';
    onOpenGpx();
  }

  const trackCount = $derived(tracksStore.tracks.length);
</script>

<!-- Right FAB column -->
<div class="fabs">
  <!-- GPS -->
  <button
    class="fab {mapStore.gpsActive ? 'active' : ''}"
    id="gps-fab"
    onclick={() => mapStore.toggleGps()}
    aria-label={mapStore.gpsActive ? 'GPS aus' : 'GPS an'}
    aria-pressed={mapStore.gpsActive}
    title="GPS"
  >
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3" fill="currentColor"/>
      <path d="M10 2V5M10 15V18M18 10H15M5 10H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.2" opacity=".35"/>
    </svg>
  </button>

  <!-- GPX Tracks (with badge) -->
  <button
    class="fab"
    id="gpx-fab"
    onclick={onOpenGpx}
    aria-label="GPX Tracks"
    title="Strecken"
    style="position:relative"
  >
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 15L7 9L11 12L15 6L18 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="3" cy="15" r="1.8" fill="currentColor"/>
      <circle cx="18" cy="9" r="1.8" fill="currentColor"/>
    </svg>
    {#if trackCount > 0}
      <span class="fab-badge">{trackCount}</span>
    {/if}
  </button>

  <!-- Recording -->
  <button
    class="fab {recordingStore.active ? 'active' : ''}"
    id="rec-fab"
    onclick={() => {
      if (recordingStore.active) onOpenGpx();
      else recordingStore.start();
    }}
    aria-label={recordingStore.active ? 'Aufnahme aktiv' : 'Aufnahme starten'}
    title={recordingStore.active ? 'Aufnahme läuft' : 'Track aufnehmen'}
    style={recordingStore.active ? 'animation:gps-pulse 1.2s ease infinite' : ''}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="9" cy="9" r="3" fill="currentColor"/>
    </svg>
  </button>

  <!-- Theme toggle -->
  <button
    class="fab"
    id="theme-fab"
    onclick={() => app.toggleTheme()}
    aria-label="Hell/Dunkel"
    title="Theme wechseln"
  >
    {#if app.isDark}
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="3.5" stroke="currentColor" stroke-width="1.7"/>
        <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M3.6 14.4l1.4-1.4M13 5l1.4-1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
    {:else}
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M15.5 11A6.5 6.5 0 017 3.5a.5.5 0 00-.6-.57A7 7 0 1015.07 12a.5.5 0 00-.57-.6 6.5 6.5 0 01-.98.07z" fill="currentColor" opacity=".9"/>
      </svg>
    {/if}
  </button>

  <!-- Fit All / Overview -->
  <button
    class="fab"
    onclick={onFitAll}
    aria-label="Übersicht"
    title="Alle anzeigen"
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
      <rect x="12" y="1" width="5" height="5" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
      <rect x="1" y="12" width="5" height="5" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
      <rect x="12" y="12" width="5" height="5" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
    </svg>
  </button>

  <!-- Settings -->
  <button
    class="fab"
    id="settings-fab"
    onclick={() => app.openSettings()}
    aria-label="Einstellungen"
    title="Einstellungen [S]"
  >⚙️</button>

  <!-- QR import/share -->
  <button
    class="fab"
    onclick={onOpenQr}
    aria-label="QR-Code"
    title="QR-Code"
  >
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.3"/>
      <rect x="9" y="1" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.3"/>
      <rect x="1" y="9" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M9 9h1v1M11 9h1M9 11v1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- Marker setzen -->
  <button
    class="fab"
    onclick={onOpenMarker}
    aria-label="Marker setzen"
    title="Marker setzen"
  >📍</button>

  <!-- GPX file import -->
  <button
    class="fab"
    onclick={() => gpxInput.click()}
    aria-label="GPX importieren"
    title="GPX-Datei importieren"
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 2v10M5 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3 14h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  </button>
</div>

<!-- Hidden file input -->
<input bind:this={gpxInput} type="file" accept=".gpx,.kml,.geojson" style="display:none" onchange={handleGpxFile} />

<style>
  .fabs {
    position: absolute;
    right: 0.6rem;
    bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-fab);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .fab {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--s2);
    border: 1px solid var(--bd2);
    color: var(--tx);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: background 0.15s, transform 0.1s;
    position: relative;
    flex-shrink: 0;
  }
  .fab:active { transform: scale(0.92); }
  .fab.active { background: var(--ac); color: #000; border-color: var(--ac); }

  .fab-badge {
    position: absolute;
    top: -4px; right: -4px;
    background: var(--ac);
    color: #000;
    font-size: 9px;
    font-weight: 800;
    border-radius: 10px;
    min-width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    font-family: var(--fh);
  }
</style>
