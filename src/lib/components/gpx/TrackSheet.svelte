<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { raceEngine } from '$lib/stores/race.svelte';
  import { navigationStore } from '$lib/stores/navigation.svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { parseGpx } from '$lib/services/gpx';
  import { encodeTrackToChunks } from '$lib/services/qr-engine';
  import QRDisplay from '../qr/QRDisplay.svelte';

  // The sheet shows whenever a track is selected
  const track      = $derived(tracksStore.selectedTrack);
  const isStart    = $derived(tracksStore.selectedTrackType === 'start');
  const open       = $derived(track !== null);

  // Category label + color
  function catLabel(cat: string): string {
    const map: Record<string, string> = {
      beginner: 'Beginner',
      mittel: 'Mittel',
      expert: 'Expert',
      'optional-logistik': 'Logistik',
      custom: 'Eigene',
    };
    return map[cat] ?? cat;
  }

  // Format distance
  function fmtDist(km: number): string {
    if (!km) return '–';
    return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
  }

  // Format elevation
  function fmtElev(m: number): string {
    if (!m) return '–';
    return `${Math.round(m)} m`;
  }

  // Stars display
  function stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
  }

  const rating   = $derived(track ? tracksStore.getRating(track.id) : 0);
  const features = $derived(track ? tracksStore.getFeatures(track.id) : []);

  let showQr      = $state(false);
  let qrChunks    = $state<string[]>([]);
  let qrLoading   = $state(false);

  // Reset QR when selected track changes
  $effect(() => {
    if (!track) { showQr = false; qrChunks = []; }
    else { showQr = false; qrChunks = []; }
  });

  async function toggleQr() {
    if (!track) return;
    if (showQr) { showQr = false; return; }
    qrLoading = true;
    try {
      // Use features-enriched GPX if available (same as QRShareModal)
      const gpx = await tracksStore.getGpxWithFeatures(track.id) ?? track.gpxString;
      qrChunks  = encodeTrackToChunks(track, gpx);
      showQr    = true;
    } finally {
      qrLoading = false;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function close() {
    tracksStore.clearSelection();
  }

  function navigateToStart() {
    if (!track) return;
    const pts = parseGpx(track.gpxString).points;
    if (pts.length === 0) return;
    mapStore.flyTo(pts[0].lat, pts[0].lng, 17);
    if (!mapStore.gpsActive) mapStore.startGps();
    navigationStore.start(track.id);
    app.toast(`Navigation zu "${track.name}" gestartet`, 'success');
    close();
  }

  function openInMaps() {
    if (!track) return;
    const pts = parseGpx(track.gpxString).points;
    if (pts.length === 0) return;
    const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
    const lat = pts[0].lat, lng = pts[0].lng;
    const url = isIos
      ? `maps://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, '_blank');
  }

  async function startRace() {
    if (!track) return;
    const pts = parseGpx(track.gpxString).points;
    if (pts.length === 0) return;
    mapStore.flyTo(pts[0].lat, pts[0].lng, 17);
    if (!mapStore.gpsActive) mapStore.startGps();
    await raceEngine.setup(track.id);
    app.toast(`Rennen vorbereitet — fahre zum Start!`, 'info');
    close();
  }

  async function shareGpx() {
    if (!track) return;
    const gpxStr = await tracksStore.getGpxWithFeatures(track.id);
    if (!gpxStr) return;
    const blob = new Blob([gpxStr], { type: 'application/gpx+xml' });
    const file = new File([blob], `${track.name}.gpx`, { type: 'application/gpx+xml' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: track.name });
        return;
      } catch {
        // Fallback to download
      }
    }
    // Download fallback
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${track.name}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteTrack() {
    if (!track) return;
    if (!confirm(`Track "${track.name}" wirklich löschen?`)) return;
    await tracksStore.removeTrack(track.id);
    close();
  }

  async function fitTrack() {
    if (!track?.bounds) return;
    mapStore.fitBounds([
      [track.bounds.south, track.bounds.west],
      [track.bounds.north, track.bounds.east],
    ]);
    close();
  }
</script>

<!-- Backdrop -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="ts-backdrop" onclick={close} role="presentation"></div>
{/if}

<!-- Sheet -->
<div class="track-sheet" class:open>
  <!-- Handle -->
  <div class="ts-handle-row">
    <div class="ts-handle"></div>
  </div>

  {#if track}
    <!-- Header -->
    <div class="ts-header">
      <div class="ts-header-left">
        <span class="ts-cat-badge" style="background:{track.color}">{catLabel(track.cat)}</span>
        <span class="ts-name">{track.name}</span>
      </div>
      <button class="ts-close" onclick={close} aria-label="Schließen">✕</button>
    </div>

    <!-- Type indicator -->
    <div class="ts-type-row">
      {#if isStart}
        <span class="ts-type-indicator" style="color:{track.color}">▶ Start</span>
      {:else}
        <span class="ts-type-indicator" style="color:{track.color}">🏁 Ziel</span>
      {/if}
    </div>

    <!-- Stats row -->
    <div class="ts-stats">
      <div class="ts-stat">
        <div class="ts-stat-val">{fmtDist(track.stats?.distKm ?? 0)}</div>
        <div class="ts-stat-lbl">Distanz</div>
      </div>
      <div class="ts-stat-sep"></div>
      <div class="ts-stat">
        <div class="ts-stat-val">↑ {fmtElev(track.stats?.elevGain ?? 0)}</div>
        <div class="ts-stat-lbl">Anstieg</div>
      </div>
      <div class="ts-stat-sep"></div>
      <div class="ts-stat">
        <div class="ts-stat-val">↓ {fmtElev(track.stats?.elevLoss ?? 0)}</div>
        <div class="ts-stat-lbl">Abstieg</div>
      </div>
      {#if track.stats?.maxElev}
        <div class="ts-stat-sep"></div>
        <div class="ts-stat">
          <div class="ts-stat-val">{fmtElev(track.stats.maxElev)}</div>
          <div class="ts-stat-lbl">Max Höhe</div>
        </div>
      {/if}
    </div>

    <!-- Stars rating -->
    <div class="ts-rating" title="Bewertung">
      {#each [1,2,3,4,5] as n}
        <button
          class="ts-star"
          class:active={n <= rating}
          onclick={() => tracksStore.setRating(track.id, n)}
          aria-label="Stern {n}"
        >{n <= rating ? '★' : '☆'}</button>
      {/each}
    </div>

    <!-- Action buttons -->
    <div class="ts-actions">
      <!-- Navigate to start -->
      <button class="ts-btn ts-btn-primary" onclick={navigateToStart} title="Zum Start navigieren">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2L14 8L8 14M14 8H2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Navigieren
      </button>

      <!-- Google/Apple Maps link -->
      <button class="ts-btn" onclick={openInMaps} title="Außen-Navigation öffnen">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 2v1M8 11v3M2 7h1M13 7h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Maps
      </button>

      <!-- Start race -->
      <button class="ts-btn ts-btn-race" onclick={startRace} title="Rennen starten">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="8" cy="8" r="2.5" fill="currentColor"/>
        </svg>
        Rennen
      </button>

      <!-- Fit track on map -->
      <button class="ts-btn" onclick={fitTrack} title="Strecke einpassen">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/>
          <rect x="11" y="1" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/>
          <rect x="1" y="11" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/>
          <rect x="11" y="11" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        Einpassen
      </button>

      <!-- Share GPX -->
      <button class="ts-btn" onclick={shareGpx} title="GPX teilen">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 11v2h10v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        Teilen
      </button>

      <!-- QR Code -->
      <button class="ts-btn {showQr ? 'ts-btn-primary' : ''}" onclick={toggleQr} disabled={qrLoading} title="QR-Code anzeigen">
        {#if qrLoading}
          <span style="font-size:14px">⏳</span>
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
            <rect x="10" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
            <rect x="1" y="10" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
            <rect x="3" y="3" width="1" height="1" fill="currentColor"/>
            <rect x="12" y="3" width="1" height="1" fill="currentColor"/>
            <rect x="3" y="12" width="1" height="1" fill="currentColor"/>
            <path d="M10 10h2v2h-2zM12 12h3M12 10h3v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        {/if}
        QR-Code
      </button>

      <!-- Delete -->
      <button class="ts-btn ts-btn-danger" onclick={deleteTrack} title="Track löschen">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 4h10M6 4V3h4v1M5 4v8h6V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Löschen
      </button>
    </div>

    <!-- QR Display -->
    {#if showQr && qrChunks.length > 0}
      <div style="padding:0.75rem;border-top:1px solid var(--bd2);display:flex;flex-direction:column;align-items:center;gap:0.5rem">
        <span class="ts-sect-title">QR-Code — {track?.name}</span>
        <QRDisplay chunks={qrChunks} size={220} />
      </div>
    {/if}

    <!-- Features list (if any) -->
    {#if features.length > 0}
      <div class="ts-feats">
        <div class="ts-sect-title">Features ({features.length})</div>
        <div class="ts-feat-list">
          {#each features as f}
            <div class="ts-feat-item">
              <span>{f.type === 'gap' ? '🌉' : f.type === 'drop' ? '⬇️' : f.type === 'root' ? '🌳' : f.type === 'rock' ? '🪨' : '📍'}</span>
              <span class="ts-feat-name">{f.name}</span>
              {#if f.diff}
                <span class="ts-feat-diff">{f.diff}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .ts-backdrop {
    position: fixed;
    inset: 0;
    z-index: 490;
    background: rgba(0,0,0,0.35);
  }

  .track-sheet {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 500;
    background: var(--s1);
    border-radius: 18px 18px 0 0;
    border-top: 1px solid var(--bd2);
    box-shadow: 0 -4px 24px rgba(0,0,0,0.4);
    transform: translateY(100%);
    transition: transform 0.32s cubic-bezier(.32,.72,0,1);
    max-height: 90vh;
    overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom, 1rem);
  }
  .track-sheet.open {
    transform: translateY(0);
  }

  /* Handle */
  .ts-handle-row {
    display: flex;
    justify-content: center;
    padding: 0.55rem 0 0;
  }
  .ts-handle {
    width: 2.5rem;
    height: 4px;
    background: var(--bd2);
    border-radius: 2px;
  }

  /* Header */
  .ts-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 1rem 0.3rem;
  }
  .ts-header-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .ts-cat-badge {
    font-family: var(--fh);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #000;
    padding: 2px 7px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .ts-name {
    font-family: var(--fh);
    font-size: 15px;
    font-weight: 700;
    color: var(--tx);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ts-close {
    background: none;
    border: none;
    color: var(--td);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .ts-close:hover { color: var(--tx); }

  /* Type indicator */
  .ts-type-row {
    padding: 0 1rem 0.4rem;
  }
  .ts-type-indicator {
    font-family: var(--fh);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  /* Stats */
  .ts-stats {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0.5rem 1rem;
    background: var(--s2);
    margin: 0 0.75rem;
    border-radius: 12px;
    border: 1px solid var(--bd2);
  }
  .ts-stat {
    flex: 1;
    text-align: center;
  }
  .ts-stat-val {
    font-family: var(--fh);
    font-size: 13px;
    font-weight: 700;
    color: var(--tx);
  }
  .ts-stat-lbl {
    font-size: 10px;
    color: var(--td);
    font-family: var(--fh);
    margin-top: 1px;
  }
  .ts-stat-sep {
    width: 1px;
    height: 2rem;
    background: var(--bd2);
    flex-shrink: 0;
  }

  /* Rating */
  .ts-rating {
    display: flex;
    justify-content: center;
    gap: 4px;
    padding: 0.5rem 1rem;
  }
  .ts-star {
    background: none;
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    color: var(--bd2);
    padding: 2px;
    transition: color 0.1s;
  }
  .ts-star.active { color: #f59e0b; }
  .ts-star:hover { color: #f59e0b; }

  /* Actions */
  .ts-actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.75rem;
  }
  .ts-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 0.6rem 0.4rem;
    background: var(--s2);
    border: 1px solid var(--bd2);
    border-radius: 12px;
    color: var(--tx);
    font-family: var(--fh);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
  }
  .ts-btn:active { transform: scale(0.94); }
  .ts-btn:hover { background: var(--s3); }
  .ts-btn-primary {
    background: var(--ac);
    border-color: var(--ac);
    color: #000;
  }
  .ts-btn-primary:hover { opacity: 0.9; background: var(--ac); }
  .ts-btn-race {
    background: #ef4444;
    border-color: #ef4444;
    color: #fff;
  }
  .ts-btn-race:hover { opacity: 0.9; background: #ef4444; }
  .ts-btn-danger {
    color: #ef4444;
    border-color: rgba(239,68,68,0.35);
  }
  .ts-btn-danger:hover { background: rgba(239,68,68,0.1); }

  /* Features */
  .ts-feats {
    padding: 0 0.75rem 1rem;
    border-top: 1px solid var(--bd2);
    margin-top: 0.5rem;
  }
  .ts-sect-title {
    font-family: var(--fh);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--td);
    text-transform: uppercase;
    padding: 0.6rem 0 0.4rem;
  }
  .ts-feat-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .ts-feat-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 12px;
    color: var(--tx);
    padding: 4px 0;
    border-bottom: 1px solid var(--bd2);
  }
  .ts-feat-item:last-child { border-bottom: none; }
  .ts-feat-name { flex: 1; font-weight: 600; }
  .ts-feat-diff {
    font-size: 10px;
    color: var(--td);
    font-family: var(--fh);
    letter-spacing: 0.3px;
  }
</style>
