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
  import QRScanner from '../../qr/QRScanner.svelte';
  import QRDisplay from '../../qr/QRDisplay.svelte';
  import type { TrackCat } from '$lib/types';

  type HubTab = 'import' | 'encode' | 'scan';
  let activeTab    = $state<HubTab>('import');
  let qrChunks     = $state<string[]>([]);
  let qrLabel      = $state('');
  let loading      = $state(false);
  let scanActive   = $state(false);
  let errorMsg     = $state('');

  let importUrl    = $state('');
  let importPaste  = $state('');
  const PASTE_PLACEHOLDER = '<xml ...> oder {type: FeatureCollection...}';
  let encodeSource = $state<'track' | 'marker' | 'project' | 'backup'>('track');
  let selTrackId   = $state('');
  let selMarkerId  = $state('');

  function showQr(chunks: string[], label: string) {
    qrChunks = chunks; qrLabel = label; errorMsg = '';
  }
  function clearQr() { qrChunks = []; qrLabel = ''; }

  // ── Import ──────────────────────────────────────────────────────────────────

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

  async function importFromPaste() {
    if (!importPaste.trim()) return;
    loading = true; errorMsg = '';
    try {
      const { gpxStr, name, cat } = parseAnyFormatToGpx(importPaste.trim());
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      app.toast(`"${name}" importiert`, 'success');
      showQr(encodeAnyFormatToChunks(importPaste.trim(), name), name);
      importPaste = '';
    } catch (ex) {
      errorMsg = (ex as Error).message;
      app.toast(`Fehler: ${errorMsg}`, 'error');
    } finally { loading = false; }
  }

  // ── Encode ──────────────────────────────────────────────────────────────────

  async function encodeTrack() {
    const id = selTrackId || tracksStore.activeProjectTracks[0]?.id;
    if (!id) return;
    loading = true; errorMsg = '';
    try {
      const track = tracksStore.getTrack(id);
      if (!track) throw new Error('Track nicht gefunden');
      const gpx = await tracksStore.getGpxWithFeatures(id) ?? track.gpxString;
      showQr(encodeTrackToChunks(track, gpx), track.name);
    } catch (ex) { errorMsg = (ex as Error).message; }
    finally { loading = false; }
  }

  function encodeMarkerQrFn() {
    const m = markersStore.custom.find(x => x.id === selMarkerId) ?? markersStore.custom[0];
    if (!m) return;
    showQr([encodeMarkerQr(m.lat, m.lng, m.name)], m.name);
  }

  async function encodeProject() {
    loading = true; errorMsg = '';
    try {
      const pid = projectsStore.activeProjectId;
      if (!pid) throw new Error('Kein aktives Projekt');
      const { exportProjectJson } = await import('$lib/services/storage');
      const json = await exportProjectJson(pid);
      showQr(encodeObjectToChunks(JSON.parse(json), 'project'), projectsStore.activeProject?.name ?? 'Projekt');
    } catch (ex) { errorMsg = (ex as Error).message; }
    finally { loading = false; }
  }

  async function encodeBackup() {
    loading = true; errorMsg = '';
    try {
      const backup = await exportFullBackup();
      showQr(encodeObjectToChunks(backup, 'backup'), 'Vollständiges Backup');
    } catch (ex) { errorMsg = (ex as Error).message; }
    finally { loading = false; }
  }
</script>

<div style="padding-top:0.75rem;display:flex;flex-direction:column;gap:0.75rem">

  <!-- Hub Tab Strip -->
  <div class="tabs" style="flex-wrap:wrap">
    {#each [['import','📥 Import'],['encode','📤 Encode'],['scan','📷 Scan']] as [id, label]}
      <button class="tab {activeTab === id ? 'active' : ''}"
        onclick={() => { activeTab = id as HubTab; clearQr(); scanActive = false; }}>
        {label}
      </button>
    {/each}
  </div>

  <!-- ── IMPORT TAB ── -->
  {#if activeTab === 'import'}

    <div class="card" style="display:flex;flex-direction:column;gap:0.6rem">
      <div class="form-label">📁 Datei importieren</div>
      <p class="text-xs text-dim">GPX, GeoJSON oder JSON — automatisch erkannt, sofort als QR angezeigt.</p>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <label style="cursor:pointer">
        <div class="btn btn-secondary w-full" style="justify-content:center;pointer-events:none">
          {loading ? '⏳ Lädt…' : '📂 Datei auswählen (.gpx / .json / .geojson)'}
        </div>
        <input type="file"
          accept=".gpx,.json,.geojson,application/gpx+xml,application/json,application/geo+json"
          style="display:none"
          onchange={importFromFile}
          disabled={loading}
        />
      </label>
    </div>

    <div class="card" style="display:flex;flex-direction:column;gap:0.5rem">
      <div class="form-label">🔗 URL importieren</div>
      <p class="text-xs text-dim">Direkt-Link zu .gpx / .geojson / .json (z.B. GitHub Raw)</p>
      <div style="display:flex;gap:0.5rem">
        <input class="input" type="url" bind:value={importUrl}
          placeholder="https://raw.githubusercontent.com/…/track.gpx" style="flex:1;min-width:0" />
        <button class="btn btn-primary" onclick={importFromUrl}
          disabled={loading || !importUrl.trim()} style="flex-shrink:0">
          {loading ? '⏳' : '↓'}
        </button>
      </div>
    </div>

    <div class="card" style="display:flex;flex-direction:column;gap:0.5rem">
      <div class="form-label">📋 GPX / GeoJSON einfügen</div>
      <textarea class="input" rows="5" bind:value={importPaste}
        {...{placeholder: PASTE_PLACEHOLDER}}
        style="font-size:0.72rem;font-family:monospace;resize:vertical"></textarea>
      <button class="btn btn-primary w-full" onclick={importFromPaste}
        disabled={loading || !importPaste.trim()}>
        {loading ? '⏳ Importiert…' : '📥 Importieren & QR erzeugen'}
      </button>
    </div>

  <!-- ── ENCODE TAB ── -->
  {:else if activeTab === 'encode'}

    <div class="card" style="display:flex;flex-direction:column;gap:0.6rem">
      <div class="form-label">Was soll codiert werden?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
        {#each [['track','🗺 Track'],['marker','📍 Marker'],['project','🗂 Projekt'],['backup','💾 Backup']] as [v, l]}
          <button class="btn {encodeSource === v ? 'btn-primary' : 'btn-secondary'}"
            onclick={() => { encodeSource = v as typeof encodeSource; clearQr(); }}>
            {l}
          </button>
        {/each}
      </div>
    </div>

    {#if encodeSource === 'track'}
      <div class="card" style="display:flex;flex-direction:column;gap:0.5rem">
        {#if tracksStore.activeProjectTracks.length === 0}
          <p class="text-sm text-dim">Keine Tracks im aktiven Projekt.</p>
        {:else}
          <select class="input" bind:value={selTrackId}>
            <option value="">— Track auswählen —</option>
            {#each tracksStore.activeProjectTracks as t}
              <option value={t.id}>{t.name} ({t.stats?.distKm?.toFixed(1) ?? '?'} km)</option>
            {/each}
          </select>
          <button class="btn btn-primary w-full" onclick={encodeTrack}
            disabled={loading || (!selTrackId && tracksStore.activeProjectTracks.length === 0)}>
            {loading ? '⏳ Generiert…' : '📤 QR-Code erzeugen'}
          </button>
        {/if}
      </div>

    {:else if encodeSource === 'marker'}
      <div class="card" style="display:flex;flex-direction:column;gap:0.5rem">
        {#if markersStore.custom.length === 0}
          <p class="text-sm text-dim">Keine eigenen Marker vorhanden.</p>
        {:else}
          <select class="input" bind:value={selMarkerId}>
            <option value="">— Marker auswählen —</option>
            {#each markersStore.custom as m}
              <option value={m.id}>{m.emoji} {m.name}</option>
            {/each}
          </select>
          <button class="btn btn-primary w-full" onclick={encodeMarkerQrFn}>📤 QR-Code erzeugen</button>
        {/if}
      </div>

    {:else if encodeSource === 'project'}
      <div class="card">
        <p class="text-sm text-dim mb-2">
          Aktives Projekt: <strong>{projectsStore.activeProject?.name ?? '—'}</strong>
        </p>
        <button class="btn btn-primary w-full" onclick={encodeProject}
          disabled={loading || !projectsStore.activeProjectId}>
          {loading ? '⏳ Generiert…' : '📤 Projekt als QR'}
        </button>
      </div>

    {:else if encodeSource === 'backup'}
      <div class="card">
        <p class="text-sm text-dim mb-2">Alle Tracks, Marker, Projekte und Einstellungen als QR-Sequenz.</p>
        <button class="btn btn-primary w-full" onclick={encodeBackup} disabled={loading}>
          {loading ? '⏳ Generiert…' : '📤 Vollständiges Backup als QR'}
        </button>
      </div>
    {/if}

  <!-- ── SCAN TAB ── -->
  {:else if activeTab === 'scan'}
    <div class="card card-sm">
      <p class="text-xs text-dim">
        Unterstützt: GMTW-Tracks (Compact), Marker, Projekte, Backups, GPX-URLs, GeoJSON, Fountain-Codes (beliebige Reihenfolge).
      </p>
    </div>
    {#if !scanActive}
      <button class="btn btn-primary w-full" onclick={() => scanActive = true}>📷 Scanner starten</button>
    {:else}
      <QRScanner onstop={() => scanActive = false} />
    {/if}
  {/if}

  <!-- Error -->
  {#if errorMsg}
    <div style="background:rgba(239,68,68,0.1);border:1px solid #ef4444;border-radius:var(--r);padding:0.6rem 0.75rem;font-size:0.8rem;color:#ef4444;word-break:break-word">
      ⚠ {errorMsg}
    </div>
  {/if}

  <!-- QR Result -->
  {#if qrChunks.length > 0}
    <div class="card" style="display:flex;flex-direction:column;align-items:center;gap:0.6rem">
      <div style="font-family:var(--fh);font-weight:700;font-size:0.9rem;color:var(--tx);text-align:center">
        {qrLabel}
      </div>
      <span class="text-xs text-dim">
        {qrChunks.length === 1 ? 'Einzel-QR-Code' : `${qrChunks.length} QR-Codes (animierte Sequenz)`}
      </span>
      <QRDisplay chunks={qrChunks} size={340} fps={2.5} />
      {#if qrChunks.length > 1}
        <p class="text-xs text-dim" style="text-align:center;max-width:220px">
          Gerät auf Kamera halten — alle Frames werden automatisch gesammelt und importiert.
        </p>
      {/if}
      <button class="btn btn-ghost btn-sm w-full" onclick={clearQr}>✕ QR schließen</button>
    </div>
  {/if}

  <!-- Info -->
  <div class="card card-sm">
    <div class="form-label mb-1">ℹ️ Unterstützte Formate</div>
    <div class="text-xs text-dim" style="display:flex;flex-direction:column;gap:3px;line-height:1.5">
      <span>• <strong>GPX (XML)</strong> — Standard-GPS-Format</span>
      <span>• <strong>GeoJSON</strong> — FeatureCollection / Feature / LineString / MultiLineString</span>
      <span>• <strong>GMTW-Compact</strong> — delta-kodiertes Format (kleiner, schneller)</span>
      <span>• <strong>URLs</strong> — Direktlinks zu .gpx / .geojson / .json</span>
      <span>• Große Dateien → automatisch in animierte QR-Sequenz aufgeteilt</span>
    </div>
  </div>
</div>
