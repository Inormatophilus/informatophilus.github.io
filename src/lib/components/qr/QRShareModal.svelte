<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { markersStore } from '$lib/stores/markers.svelte';
  import { projectsStore } from '$lib/stores/projects.svelte';
  import { exportFullBackup } from '$lib/services/storage';
  import {
    encodeTrackToChunks, encodeObjectToChunks, encodeMarkerQr,
    parseAnyFormatToGpx, fetchAndParseUrl, encodeAnyFormatToChunks,
  } from '$lib/services/qr-engine';
  import { app } from '$lib/stores/app.svelte';
  import type { TrackCat } from '$lib/types';
  import BottomSheet from '../ui/BottomSheet.svelte';
  import QRDisplay from './QRDisplay.svelte';
  import QRScanner from './QRScanner.svelte';

  interface Props {
    open: boolean;
    onclose?: () => void;
  }
  let { open = $bindable(), onclose }: Props = $props();

  type Mode = 'select' | 'qr' | 'scan';
  let mode      = $state<Mode>('select');
  let chunks    = $state<string[]>([]);
  let qrLabel   = $state('');
  let loading   = $state(false);
  let errorMsg  = $state('');
  let importUrl = $state('');

  function showQr(c: string[], label: string) {
    chunks = c; qrLabel = label; errorMsg = ''; mode = 'qr';
  }

  function reset() { mode = 'select'; chunks = []; qrLabel = ''; errorMsg = ''; importUrl = ''; }

  // ── Encode existing data ──────────────────────────────────────────────────

  async function encodeTrack(id: string) {
    loading = true; errorMsg = '';
    try {
      const track = tracksStore.getTrack(id);
      if (!track) return;
      const gpx = await tracksStore.getGpxWithFeatures(id) ?? track.gpxString;
      showQr(encodeTrackToChunks(track, gpx), track.name);
    } catch (e) {
      errorMsg = (e as Error).message;
      app.toast(`Fehler: ${errorMsg}`, 'error');
    } finally { loading = false; }
  }

  async function encodeBackup() {
    loading = true; errorMsg = '';
    try {
      const backup = await exportFullBackup();
      showQr(encodeObjectToChunks(backup, 'backup'), 'Vollständiges Backup');
    } catch (e) {
      errorMsg = (e as Error).message;
      app.toast(`Fehler: ${errorMsg}`, 'error');
    } finally { loading = false; }
  }

  async function encodeProject(id: string) {
    loading = true; errorMsg = '';
    try {
      const { exportProjectJson } = await import('$lib/services/storage');
      const json = await exportProjectJson(id);
      const name = projectsStore.projects.find(p => p.id === id)?.name ?? 'Projekt';
      showQr(encodeObjectToChunks(JSON.parse(json), 'project'), name);
    } catch (e) {
      errorMsg = (e as Error).message;
      app.toast(`Fehler: ${errorMsg}`, 'error');
    } finally { loading = false; }
  }

  // ── Import → Track + QR ──────────────────────────────────────────────────

  async function importFromFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    loading = true; errorMsg = '';
    try {
      const text = await file.text();
      const { gpxStr, name, cat } = parseAnyFormatToGpx(text);
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      app.toast(`"${name}" importiert`, 'success');
      showQr(encodeAnyFormatToChunks(text, name), name);
    } catch (ex) {
      errorMsg = (ex as Error).message;
      app.toast(`Fehler: ${errorMsg}`, 'error');
    } finally {
      loading = false;
      (e.target as HTMLInputElement).value = '';
    }
  }

  async function importFromUrl() {
    if (!importUrl.trim()) return;
    loading = true; errorMsg = '';
    try {
      const { gpxStr, name, cat } = await fetchAndParseUrl(importUrl.trim());
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      app.toast(`"${name}" von URL importiert`, 'success');
      showQr(encodeAnyFormatToChunks(gpxStr, name), name);
      importUrl = '';
    } catch (ex) {
      errorMsg = (ex as Error).message;
      app.toast(`URL-Fehler: ${errorMsg}`, 'error');
    } finally { loading = false; }
  }
</script>

<BottomSheet
  {open}
  title="QR-Code"
  onclose={() => { reset(); onclose?.(); }}
  maxHeight="90vh"
>
  {#if mode === 'select'}
    <div style="display:flex;flex-direction:column;gap:0.75rem">

      <!-- File Import -->
      <div class="card" style="display:flex;flex-direction:column;gap:0.4rem">
        <div class="form-label">📁 Datei importieren & als QR teilen</div>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <label style="cursor:pointer">
          <div class="btn btn-secondary w-full" style="justify-content:center;pointer-events:none">
            {loading ? '⏳ Lädt…' : '📂 GPX / GeoJSON / JSON wählen'}
          </div>
          <input type="file"
            accept=".gpx,.json,.geojson,application/gpx+xml,application/json,application/geo+json"
            style="display:none"
            onchange={importFromFile}
            disabled={loading}
          />
        </label>
      </div>

      <!-- URL Import -->
      <div class="card" style="display:flex;flex-direction:column;gap:0.4rem">
        <div class="form-label">🔗 URL importieren & als QR teilen</div>
        <div style="display:flex;gap:0.4rem">
          <input class="input" type="url" bind:value={importUrl}
            placeholder="https://…/track.gpx" style="flex:1;min-width:0;font-size:0.8rem" />
          <button class="btn btn-primary" onclick={importFromUrl}
            disabled={loading || !importUrl.trim()} style="flex-shrink:0">
            {loading ? '⏳' : '↓'}
          </button>
        </div>
      </div>

      <!-- Track selection -->
      {#if tracksStore.activeProjectTracks.length > 0}
        <div class="card">
          <div class="form-label mb-2">🗺 Track als QR</div>
          {#each tracksStore.activeProjectTracks as track}
            <button
              style="width:100%;display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border:none;background:none;cursor:pointer;color:var(--tx);text-align:left;border-bottom:1px solid var(--bd)"
              onclick={() => encodeTrack(track.id)}
              disabled={loading}
            >
              <span>🗺</span>
              <span class="flex-1 truncate text-sm">{track.name}</span>
              <span class="text-xs text-dim">{track.stats.distKm.toFixed(1)} km</span>
              <span style="color:var(--ac)">▶</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Projekt QR -->
      {#if projectsStore.activeProject}
        <button class="btn btn-secondary w-full" onclick={() => encodeProject(projectsStore.activeProjectId!)} disabled={loading}>
          🗂 Aktives Projekt als QR
        </button>
      {/if}

      <!-- Backup QR -->
      <button class="btn btn-secondary w-full" onclick={encodeBackup} disabled={loading}>
        {loading ? '⏳ Generiere…' : '💾 Vollständiges Backup als QR'}
      </button>

      <!-- QR Scanner -->
      <button class="btn btn-primary w-full" onclick={() => mode = 'scan'}>
        📷 QR-Code scannen
      </button>

      <!-- Error -->
      {#if errorMsg}
        <div style="background:rgba(239,68,68,0.1);border:1px solid #ef4444;border-radius:var(--r);padding:0.5rem 0.75rem;font-size:0.8rem;color:#ef4444;word-break:break-word">
          ⚠ {errorMsg}
        </div>
      {/if}
    </div>

  {:else if mode === 'qr'}
    <div style="display:flex;flex-direction:column;align-items:center;gap:0.75rem">
      {#if qrLabel}
        <div style="font-family:var(--fh);font-weight:700;font-size:0.95rem;color:var(--tx)">{qrLabel}</div>
      {/if}
      <span class="text-xs text-dim">
        {chunks.length === 1 ? 'Einzel-QR-Code' : `${chunks.length} QR-Codes (animierte Sequenz)`}
      </span>
      <QRDisplay {chunks} size={260} fps={3} />
      {#if chunks.length > 1}
        <p class="text-xs text-dim text-center" style="max-width:220px">
          Alle Frames nacheinander scannen — beliebige Reihenfolge.
        </p>
      {/if}
      <button class="btn btn-secondary" onclick={reset}>← Zurück</button>
    </div>

  {:else if mode === 'scan'}
    <QRScanner onstop={() => { mode = 'select'; onclose?.(); }} />
  {/if}
</BottomSheet>
