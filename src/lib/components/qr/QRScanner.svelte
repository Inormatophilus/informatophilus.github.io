<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    createChunkBuffer, parseChunkPayload, collectChunk, assembleChunks,
    decompressPayload, detectPayloadType, isFountainChunk, decodeFountainChunks,
    decodeCompactToTrack, buildGpxFromPoints, parseAnyFormatToGpx, fetchAndParseUrl,
    type DecodedTrackResult,
  } from '$lib/services/qr-engine';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { markersStore } from '$lib/stores/markers.svelte';
  import { importFullBackup, importProjectJson } from '$lib/services/storage';
  import { db } from '$lib/services/database';
  import { app } from '$lib/stores/app.svelte';
  import type { QrChunkBuffer, QrChunk, TrackCat, TrackCondition } from '$lib/types';

  interface Props { onstop?: () => void; }
  let { onstop }: Props = $props();

  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let stream: MediaStream | null = null;

  // Scanner state
  let scanning    = $state(false);
  let status      = $state('Starte Kamera…');
  let statusType  = $state<'info' | 'ok' | 'err' | 'progress'>('info');
  let progress    = $state(0);

  // Chunk tracking (v2 protocol)
  let chunkBuf: QrChunkBuffer | null = null;
  let seenSeqChunks = new Set<string>();
  let lastChecksum: string | undefined;
  let trackName = $state<string | undefined>();

  // Per-chunk visual tracking
  let receivedChunks = $state<boolean[]>([]);
  let totalChunks    = $state(0);

  // Fountain buffer
  let fountainChunks: string[] = [];
  let fountainK = 0;
  let seenFountain = new Set<string>();

  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let doneFlag = false;

  // Manual text input fallback
  let showManual  = $state(false);
  let manualText  = $state('');
  const PASTE_PLACEHOLDER = '<xml ...> oder {type: FeatureCollection...}';
  let manualUrl   = $state('');
  let processing  = $state(false);

  // Letzte Scan-Ergebnis für Debounce
  let lastScanResult = '';
  let lastScanTs = 0;

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
        }
      });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      setStatus('QR-Code in die Kamera halten…', 'info');
      startScan();
    } catch (e) {
      setStatus(`Kamera nicht verfügbar: ${e}`, 'err');
    }
  });

  onDestroy(() => stop());

  function stop() {
    scanning = false;
    if (scanTimer !== null) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
  }

  function setStatus(msg: string, type: 'info' | 'ok' | 'err' | 'progress' = 'info') {
    status = msg;
    statusType = type;
  }

  function reset() {
    chunkBuf = null;
    seenSeqChunks.clear();
    lastChecksum = undefined;
    trackName = undefined;
    fountainChunks = [];
    fountainK = 0;
    seenFountain.clear();
    progress = 0;
    receivedChunks = [];
    totalChunks = 0;
    doneFlag = false;
    lastScanResult = '';
    setStatus('QR-Code in die Kamera halten…', 'info');
  }

  /** Scan-Loop: 12fps statt requestAnimationFrame (stabiler, weniger CPU) */
  function startScan() {
    if (scanTimer !== null) return;
    scanTimer = setInterval(async () => {
      if (!scanning || !video || video.readyState < 2) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const jsQR = (await import('jsqr')).default;
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code?.data) {
          // Debounce: gleichen Code nicht innerhalb von 300ms erneut verarbeiten
          const now = Date.now();
          if (code.data === lastScanResult && now - lastScanTs < 300) return;
          lastScanResult = code.data;
          lastScanTs = now;
          await processQrData(code.data);
        }
      } catch { /* jsQR error — continue */ }
    }, 83); // ~12fps
  }

  /** Haptisches Feedback bei erfolgreichem Chunk-Scan */
  function vibrateSuccess() {
    try { navigator.vibrate?.([50]); } catch { /**/ }
  }

  function vibrateComplete() {
    try { navigator.vibrate?.([100, 50, 100]); } catch { /**/ }
  }

  // ── Main dispatch ───────────────────────────────────────────────────────────

  async function processQrData(raw: string) {
    if (doneFlag) return;

    // 1. Fountain chunk
    if (isFountainChunk(raw)) {
      if (seenFountain.has(raw)) return;
      seenFountain.add(raw);
      fountainChunks = [...fountainChunks, raw];
      vibrateSuccess();
      if (fountainK === 0) {
        try { fountainK = (JSON.parse(raw) as { m: { k: number } }).m.k; } catch { /**/ }
      }
      progress = fountainK > 0 ? Math.min(99, (fountainChunks.length / fountainK) * 100) : 0;
      setStatus(`Fountain: ${fountainChunks.length}/${fountainK} Chunks`, 'progress');

      if (fountainChunks.length >= fountainK) {
        const decoded = decodeFountainChunks(fountainChunks);
        if (decoded) {
          vibrateComplete();
          const jsonStr = decompressPayload(decoded);
          await processPayload(jsonStr);
        }
      }
      return;
    }

    // 2. Standard sequential chunk (v1 + v2 kompatibel)
    const chunk = parseChunkPayload(raw);
    if (chunk) {
      const key = `${chunk.idx}:${chunk.total}`;
      if (seenSeqChunks.has(key)) return;
      seenSeqChunks.add(key);

      if (!chunkBuf) chunkBuf = createChunkBuffer();

      // v2: Track-Name und Checksum aus Chunk-Metadaten extrahieren
      if ((chunk as QrChunk).first && (chunk as QrChunk).name) {
        trackName = (chunk as QrChunk).name;
      }
      if ((chunk as QrChunk).last && (chunk as QrChunk).checksum) {
        lastChecksum = (chunk as QrChunk).checksum;
      }

      const done = collectChunk(chunk, chunkBuf);
      vibrateSuccess();

      // Chunk-Tracking für visuelle Anzeige
      if (totalChunks !== chunk.total) {
        totalChunks = chunk.total;
        receivedChunks = new Array(chunk.total).fill(false);
      }
      receivedChunks[chunk.idx] = true;
      receivedChunks = [...receivedChunks]; // trigger reactivity

      progress = chunkBuf.total > 0 ? (chunkBuf.chunks.size / chunkBuf.total) * 100 : 0;

      const nameHint = trackName ? ` "${trackName}"` : '';
      if (chunk.total === 1) {
        setStatus(`Einzel-QR empfangen${nameHint}`, 'progress');
      } else if ((chunk as QrChunk).first) {
        setStatus(`START empfangen: ${chunkBuf.chunks.size}/${chunkBuf.total}${nameHint}`, 'progress');
      } else if ((chunk as QrChunk).last) {
        setStatus(`LETZTER empfangen: ${chunkBuf.chunks.size}/${chunkBuf.total}${nameHint}`, 'progress');
      } else {
        setStatus(`${chunkBuf.chunks.size} / ${chunkBuf.total} Chunks${nameHint}`, 'progress');
      }

      if (done) {
        vibrateComplete();
        try {
          const assembled = assembleChunks(chunkBuf, lastChecksum);
          const jsonStr   = decompressPayload(assembled);
          await processPayload(jsonStr, chunkBuf.type as string);
        } catch (e) {
          setStatus(`Fehler: ${(e as Error).message}`, 'err');
          // Reset für erneuten Scan-Versuch
          chunkBuf = null;
          seenSeqChunks.clear();
          receivedChunks = [];
          totalChunks = 0;
          progress = 0;
        }
      }
      return;
    }

    // 3. URL QR → fetch
    if (/^https?:\/\/.+/i.test(raw)) {
      await processUrl(raw);
      return;
    }

    // 4. Raw GPX / GeoJSON / direct JSON
    await processRaw(raw);
  }

  // ── Payload processors ──────────────────────────────────────────────────────

  async function processPayload(jsonStr: string, hint?: string) {
    if (doneFlag) return;
    doneFlag = true;
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(jsonStr); } catch { parsed = jsonStr; }
      const type = hint ?? detectPayloadType(parsed);

      switch (type) {
        case 'track': {
          const decoded = decodeCompactToTrack(jsonStr);
          if (decoded.points.length < 2) {
            throw new Error(`Track enthält nur ${decoded.points.length} Punkt(e) — ungültig`);
          }
          const gpxStr = buildGpxFromPoints(decoded.points, decoded.name);

          // 1. Track in IndexedDB speichern → überlebt Neustart
          const newTrack = await tracksStore.loadGpxString(
            gpxStr, decoded.name, (decoded.cat as TrackCat) || 'custom',
            undefined, true // silent — eigener Toast folgt
          );

          // 2. v2-Metadaten importieren (Features, Rating, Beschreibung, etc.)
          await importTrackMetadata(newTrack.id, decoded);

          // 3. Status-Zusammenfassung
          const parts: string[] = [`${decoded.points.length} Punkte`];
          if (decoded.features?.length) parts.push(`${decoded.features.length} Features`);
          if (decoded.runs?.length) parts.push(`${decoded.runs.length} Zeiten`);
          if (decoded.rating) parts.push(`${decoded.rating}★`);

          finish(`✓ Track "${decoded.name}" importiert (${parts.join(', ')})`, 'ok');
          app.toast(`Track "${decoded.name}" via QR geladen`, 'success');
          break;
        }
        case 'backup': {
          const data = JSON.parse(jsonStr);
          await importFullBackup(data);
          finish('✓ Backup erfolgreich importiert', 'ok');
          app.toast('Backup importiert', 'success');
          break;
        }
        case 'project': {
          await importProjectJson(jsonStr);
          finish('✓ Projekt importiert', 'ok');
          app.toast('Projekt importiert', 'success');
          break;
        }
        case 'marker': {
          const data = JSON.parse(jsonStr) as { type?: string; lat?: number; lng?: number; name?: string; emoji?: string };
          if (typeof data.lat === 'number' && typeof data.lng === 'number') {
            await markersStore.addCustomMarker({
              name: data.name ?? 'QR Marker',
              emoji: data.emoji ?? '📍',
              cat: 'point',
              desc: '',
              gmapsUrl: markersStore.buildMapsUrl(data.lat, data.lng),
              lat: data.lat,
              lng: data.lng,
            });
            finish(`✓ Marker "${data.name ?? 'QR Marker'}" importiert`, 'ok');
            app.toast('Marker importiert', 'success');
          } else {
            finish('Marker-Daten ungültig', 'err');
          }
          break;
        }
        default:
          setStatus(`Unbekannter QR-Typ: ${type}`, 'err');
          doneFlag = false;
      }
    } catch (e) {
      setStatus(`Import-Fehler: ${(e as Error).message}`, 'err');
      doneFlag = false;
    }
  }

  async function processRaw(raw: string) {
    if (doneFlag) return;

    // gmtw-marker JSON (single simple QR)
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type === 'gmtw-marker' && typeof obj.lat === 'number' && typeof obj.lng === 'number') {
        doneFlag = true;
        vibrateComplete();
        await markersStore.addCustomMarker({
          name: String(obj.name ?? 'QR Marker'),
          emoji: '📍',
          cat: 'point',
          desc: '',
          gmapsUrl: markersStore.buildMapsUrl(obj.lat as number, obj.lng as number),
          lat: obj.lat as number,
          lng: obj.lng as number,
        });
        finish(`✓ Marker "${obj.name ?? 'QR Marker'}" importiert`, 'ok');
        app.toast('Marker importiert', 'success');
        return;
      }
    } catch { /**/ }

    // Try GPX / GeoJSON / Compact
    try {
      doneFlag = true;
      vibrateComplete();
      const { gpxStr, name, cat } = parseAnyFormatToGpx(raw);
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom', undefined, true);
      finish(`✓ Track "${name}" importiert`, 'ok');
      app.toast(`Track "${name}" importiert`, 'success');
    } catch (e) {
      doneFlag = false;
      setStatus(`QR nicht erkannt: ${(e as Error).message}`, 'err');
    }
  }

  async function processUrl(url: string) {
    if (doneFlag) return;
    const isDataUrl = /\.(gpx|geojson|json)(\?.*)?$/i.test(url);
    if (!isDataUrl) return;
    doneFlag = true;
    setStatus('URL wird geladen…', 'progress');
    try {
      const { gpxStr, name, cat } = await fetchAndParseUrl(url);
      vibrateComplete();
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom', undefined, true);
      finish(`✓ Track "${name}" von URL geladen`, 'ok');
      app.toast(`Track "${name}" importiert`, 'success');
    } catch (e) {
      doneFlag = false;
      setStatus(`URL-Fehler: ${(e as Error).message}`, 'err');
    }
  }

  function finish(msg: string, type: 'ok' | 'err') {
    setStatus(msg, type);
    progress = type === 'ok' ? 100 : 0;
    setTimeout(() => { stop(); onstop?.(); }, 2200);
  }

  // ── Track-Metadaten-Import (v2) ──────────────────────────────────────────────

  /**
   * Importiert alle v2-Metadaten für einen Track nach dessen Erstellung.
   * Features, Bewertung, Beschreibung, Streckenzustand, Rennzeiten.
   */
  async function importTrackMetadata(trackId: string, decoded: DecodedTrackResult) {
    try {
      // Features (Schlüsselstellen)
      if (decoded.features && decoded.features.length > 0) {
        for (const feat of decoded.features) {
          await tracksStore.addFeature(trackId, feat);
        }
      }

      // Bewertung
      if (decoded.rating !== undefined && decoded.rating > 0) {
        await tracksStore.setRating(trackId, decoded.rating);
      }

      // Beschreibung
      if (decoded.desc) {
        await tracksStore.setDescription(trackId, decoded.desc);
      }

      // Streckenzustand
      if (decoded.cond && decoded.cond !== 'unknown') {
        await tracksStore.setCondition(trackId, decoded.cond as TrackCondition);
      }

      // Rennzeiten (Runs) — mit neuer Track-ID verknüpfen
      if (decoded.runs && decoded.runs.length > 0) {
        const runsWithTrackId = decoded.runs.map(r => ({
          ...r,
          id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          trackId,
        }));
        await db.runs.bulkPut(runsWithTrackId);
      }

      // Track auf Karte rendern (mit Features)
      const track = tracksStore.getTrack(trackId);
      if (track) {
        await tracksStore.renderTrackOnMap(track);
      }
    } catch (e) {
      console.warn('Metadaten-Import teilweise fehlgeschlagen:', e);
    }
  }

  // ── Manual import ────────────────────────────────────────────────────────────

  async function submitManualText() {
    if (!manualText.trim()) return;
    processing = true;
    try {
      const { gpxStr, name, cat } = parseAnyFormatToGpx(manualText.trim());
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      app.toast(`Track "${name}" importiert`, 'success');
      stop();
      onstop?.();
    } catch (e) {
      app.toast(`Fehler: ${(e as Error).message}`, 'error');
    } finally {
      processing = false;
    }
  }

  async function submitManualUrl() {
    if (!manualUrl.trim()) return;
    processing = true;
    try {
      const { gpxStr, name, cat } = await fetchAndParseUrl(manualUrl.trim());
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      app.toast(`Track "${name}" importiert`, 'success');
      stop();
      onstop?.();
    } catch (e) {
      app.toast(`Fehler: ${(e as Error).message}`, 'error');
    } finally {
      processing = false;
    }
  }
</script>

<div class="scanner-wrap">
  <!-- Camera viewfinder -->
  <div class="scanner-viewport">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline autoplay muted class="scanner-video"></video>
    <canvas bind:this={canvas} style="display:none"></canvas>

    <!-- Viewfinder crosshair -->
    <div class="scanner-overlay">
      <div class="scanner-frame"></div>
    </div>

    <!-- Status overlay -->
    <div class="scanner-status" class:status-ok={statusType === 'ok'} class:status-err={statusType === 'err'} class:status-progress={statusType === 'progress'}>
      {status}
    </div>

    <!-- Inline progress for multi-chunk -->
    {#if progress > 0 && progress < 100}
      <div class="scanner-progress-bar">
        <div class="scanner-progress-fill" style="width:{progress.toFixed(0)}%"></div>
      </div>
    {/if}

    <!-- Success checkmark overlay -->
    {#if statusType === 'ok'}
      <div class="scanner-success-overlay">
        <div class="scanner-success-icon">✓</div>
      </div>
    {/if}
  </div>

  <!-- Chunk grid (per-chunk visual tracking) -->
  {#if totalChunks > 1}
    <div class="chunk-grid-wrap">
      <div class="chunk-grid-label">
        {#if trackName}
          <strong>{trackName}</strong> —
        {/if}
        {receivedChunks.filter(Boolean).length} / {totalChunks} Chunks empfangen
      </div>
      <div class="chunk-grid">
        {#each receivedChunks as received, i}
          <div
            class="chunk-cell"
            class:chunk-received={received}
            class:chunk-first={i === 0}
            class:chunk-last={i === totalChunks - 1}
            title="QR {i + 1}{i === 0 ? ' (START)' : ''}{i === totalChunks - 1 ? ' (LETZTER)' : ''}"
          >
            {#if i === 0}S{:else if i === totalChunks - 1}E{:else}{i + 1}{/if}
          </div>
        {/each}
      </div>
      <button class="btn btn-ghost btn-sm" onclick={reset}>↺ Reset</button>
    </div>
  {/if}

  <!-- Action buttons -->
  <div class="scanner-actions">
    <button class="btn btn-secondary" onclick={() => showManual = !showManual}>
      ✍ Manuell
    </button>
    <button class="btn btn-danger" onclick={() => { stop(); onstop?.(); }}>
      ⏹ Stoppen
    </button>
  </div>

  <!-- Manual fallback -->
  {#if showManual}
    <div class="card" style="display:flex;flex-direction:column;gap:0.5rem">
      <span class="form-label">URL (GPX / GeoJSON)</span>
      <div style="display:flex;gap:0.5rem">
        <input class="input" type="url" bind:value={manualUrl}
          placeholder="https://…/track.gpx" style="flex:1" />
        <button class="btn btn-primary" onclick={submitManualUrl} disabled={processing || !manualUrl.trim()}>
          {processing ? '⏳' : '↓'}
        </button>
      </div>

      <span class="form-label">GPX / GeoJSON / JSON einfügen</span>
      <textarea class="input" rows="4" bind:value={manualText}
        {...{placeholder: PASTE_PLACEHOLDER}} style="font-size:0.75rem;font-family:monospace"></textarea>
      <button class="btn btn-primary w-full" onclick={submitManualText}
        disabled={processing || !manualText.trim()}>
        {processing ? '⏳ Wird importiert…' : '📥 Importieren'}
      </button>
    </div>
  {/if}
</div>

<style>
  .scanner-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .scanner-viewport {
    position: relative;
    border-radius: var(--r2, 12px);
    overflow: hidden;
    background: #000;
    aspect-ratio: 1;
  }

  .scanner-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .scanner-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .scanner-frame {
    width: 65%;
    aspect-ratio: 1;
    border: 3px solid var(--ac, #c8ff00);
    border-radius: var(--r, 8px);
    opacity: 0.9;
    box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.35);
    animation: scanner-pulse 2s ease-in-out infinite;
  }

  @keyframes scanner-pulse {
    0%, 100% { border-color: var(--ac, #c8ff00); opacity: 0.9; }
    50% { border-color: #fff; opacity: 0.6; }
  }

  .scanner-status {
    position: absolute;
    top: 0.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.75);
    border-radius: 1rem;
    padding: 0.3rem 0.85rem;
    white-space: nowrap;
    font-size: 0.75rem;
    font-family: var(--fh);
    font-weight: 700;
    color: var(--td, #999);
    max-width: 90%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-ok { color: #22c55e; }
  .status-err { color: #ef4444; }
  .status-progress { color: var(--ac, #c8ff00); }

  .scanner-progress-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: rgba(0, 0, 0, 0.4);
  }

  .scanner-progress-fill {
    height: 100%;
    background: var(--ac, #c8ff00);
    transition: width 0.15s;
  }

  .scanner-success-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(34, 197, 94, 0.2);
    animation: success-fade 0.4s ease-out;
  }

  .scanner-success-icon {
    font-size: 4rem;
    color: #22c55e;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    animation: success-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes success-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes success-pop {
    from { transform: scale(0.3); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  /* Chunk grid */
  .chunk-grid-wrap {
    background: var(--s2, #1a1e28);
    border-radius: var(--r, 8px);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border: 1px solid var(--bd, #333);
  }

  .chunk-grid-label {
    font-family: var(--fh);
    font-size: 0.78rem;
    color: var(--ac, #c8ff00);
    font-weight: 700;
  }

  .chunk-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .chunk-cell {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: var(--s3, #252a36);
    border: 1px solid var(--bd, #333);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    font-family: var(--fh);
    font-weight: 700;
    color: var(--td, #666);
    transition: all 0.2s;
  }

  .chunk-received {
    background: var(--ac, #c8ff00);
    color: #000;
    border-color: var(--ac, #c8ff00);
    box-shadow: 0 0 4px rgba(200, 255, 0, 0.3);
  }

  .chunk-first {
    border-color: var(--ac, #c8ff00);
  }

  .chunk-last {
    border-color: #22c55e;
  }

  .scanner-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
</style>
