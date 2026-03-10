<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { markersStore } from '$lib/stores/markers.svelte';
  import { projectsStore } from '$lib/stores/projects.svelte';
  import { exportFullBackup } from '$lib/services/storage';
  import { db } from '$lib/services/database';
  import {
    encodeTrackToChunks, encodeObjectToChunks, encodeMarkerQr,
    parseAnyFormatToGpx, fetchAndParseUrl, encodeAnyFormatToChunks,
  } from '$lib/services/qr-engine';
  import { app } from '$lib/stores/app.svelte';
  import type { TrackCat, TrackShareData } from '$lib/types';
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
  let qrInfo    = $state('');
  let loading   = $state(false);
  let errorMsg  = $state('');
  let importUrl = $state('');

  // Toggle: Rennzeiten mit übertragen
  let includeRuns = $state(true);

  function showQr(c: string[], label: string, info = '') {
    chunks = c; qrLabel = label; qrInfo = info; errorMsg = ''; mode = 'qr';
  }

  function reset() { mode = 'select'; chunks = []; qrLabel = ''; qrInfo = ''; errorMsg = ''; importUrl = ''; }

  // ── Encode Track mit ALLEN Metadaten ──────────────────────────────────────

  async function encodeTrack(id: string) {
    loading = true; errorMsg = '';
    try {
      const track = tracksStore.getTrack(id);
      if (!track) return;

      // Alle Metadaten sammeln
      const meta: TrackShareData = {};

      // Features (Schlüsselstellen)
      const features = tracksStore.getFeatures(id);
      if (features.length > 0) meta.features = features;

      // Bewertung
      const rating = tracksStore.getRating(id);
      if (rating > 0) meta.rating = rating;

      // Beschreibung
      const desc = tracksStore.getDescription(id);
      if (desc) meta.desc = desc;

      // Streckenzustand
      const cond = tracksStore.getCondition(id);
      if (cond !== 'unknown') meta.cond = cond;

      // Bearbeitungshistorie
      const edits = tracksStore.getEdits(id);
      if (edits.length > 0) meta.edits = edits;

      // Rennzeiten (optional per Toggle)
      if (includeRuns) {
        const runs = await db.runs.where('trackId').equals(id).toArray();
        if (runs.length > 0) meta.runs = runs;
      }

      // Encoding mit neuer API (keine GPX-Feature-Injektion mehr nötig!)
      const encoded = encodeTrackToChunks(track, meta);
      if (encoded.length === 0) throw new Error('Track hat keine gültigen Punkte');

      // Info-Text zusammenstellen
      const parts: string[] = [];
      if (features.length > 0) parts.push(`${features.length} Schlüsselstellen`);
      if (rating > 0) parts.push(`${rating}★`);
      if (desc) parts.push('Beschreibung');
      if (meta.runs?.length) parts.push(`${meta.runs.length} Rennzeiten`);
      const info = parts.length > 0 ? `Enthält: ${parts.join(', ')}` : '';

      showQr(encoded, track.name, info);
    } catch (e) {
      errorMsg = (e as Error).message;
      app.toast(`Fehler: ${errorMsg}`, 'error');
    } finally { loading = false; }
  }

  async function encodeBackup() {
    loading = true; errorMsg = '';
    try {
      const backup = await exportFullBackup();
      showQr(encodeObjectToChunks(backup, 'backup', 'Backup'), 'Vollständiges Backup');
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
      showQr(encodeObjectToChunks(JSON.parse(json), 'project', name), name);
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
  title="QR-Code Teilen"
  onclose={() => { reset(); onclose?.(); }}
  maxHeight="92vh"
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
          <div class="form-label mb-2">🗺 Strecke als QR teilen</div>
          <div class="text-xs text-dim" style="margin-bottom:0.4rem">
            Strecke inkl. Schlüsselstellen, Bewertung und optional Rennzeiten teilen.
            Auch selbst aufgenommene Strecken können geteilt werden.
          </div>

          <!-- Runs Toggle -->
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--bd)">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;flex:1">
              <input type="checkbox" bind:checked={includeRuns}
                style="accent-color:var(--ac);width:16px;height:16px" />
              <span class="text-sm" style="font-weight:600;color:var(--tx)">Rennzeiten mit übertragen</span>
            </label>
          </div>

          {#each tracksStore.activeProjectTracks as track}
            <button
              style="width:100%;display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;border:none;background:none;cursor:pointer;color:var(--tx);text-align:left;border-bottom:1px solid var(--bd)"
              onclick={() => encodeTrack(track.id)}
              disabled={loading}
            >
              <span style="font-size:1.1rem">🗺</span>
              <span class="flex-1 truncate text-sm" style="font-weight:600">{track.name}</span>
              <span class="text-xs text-dim">{track.stats.distKm.toFixed(1)} km</span>
              <span style="color:var(--ac);font-size:1.2rem">▶</span>
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
      <button class="btn btn-primary w-full" onclick={() => mode = 'scan'} style="font-size:1rem;padding:0.75rem">
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
        <div style="font-family:var(--fh);font-weight:700;font-size:1rem;color:var(--tx)">{qrLabel}</div>
      {/if}

      {#if chunks.length > 1}
        <div style="background:var(--s2);border:1px solid var(--bd);border-radius:var(--r);padding:0.4rem 0.75rem;text-align:center">
          <span class="text-xs text-dim">
            <strong style="color:var(--ac)">{chunks.length}</strong> QR-Codes —
            Gerät ruhig vor die Scanner-Kamera halten.
          </span>
        </div>
      {:else}
        <span class="text-xs text-dim">Einzel-QR-Code</span>
      {/if}

      <!-- Info über enthaltene Daten -->
      {#if qrInfo}
        <div style="background:rgba(200,255,0,0.08);border:1px solid color-mix(in srgb, var(--ac) 30%, var(--bd));border-radius:var(--r);padding:0.35rem 0.7rem;text-align:center">
          <span class="text-xs" style="color:var(--ac);font-weight:600">{qrInfo}</span>
        </div>
      {/if}

      <QRDisplay {chunks} size={340} fps={2.5} />

      {#if chunks.length > 1}
        <p class="text-xs text-dim text-center" style="max-width:280px;line-height:1.5">
          Der Scanner sammelt automatisch alle Codes und fügt sie zu einer vollständigen GPX-Strecke zusammen.
          Schlüsselstellen, Bewertung und Rennzeiten werden mit übertragen.
        </p>
      {/if}
      <button class="btn btn-secondary" onclick={reset}>← Zurück</button>
    </div>

  {:else if mode === 'scan'}
    <QRScanner onstop={() => { mode = 'select'; onclose?.(); }} />
  {/if}
</BottomSheet>
