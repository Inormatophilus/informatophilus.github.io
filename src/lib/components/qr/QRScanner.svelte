<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    createChunkBuffer, parseChunkPayload, collectChunk, assembleChunks,
    decompressPayload, detectPayloadType, isFountainChunk, decodeFountainChunks,
    decodeCompactToTrack, buildGpxFromPoints, parseAnyFormatToGpx, fetchAndParseUrl,
  } from '$lib/services/qr-engine';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { markersStore } from '$lib/stores/markers.svelte';
  import { importFullBackup, importProjectJson } from '$lib/services/storage';
  import { app } from '$lib/stores/app.svelte';
  import type { QrChunkBuffer, TrackCat } from '$lib/types';

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

  // Sequential chunk buffer
  let chunkBuf: QrChunkBuffer | null = null;
  let seenSeqChunks = new Set<string>(); // dedup for sequential

  // Fountain buffer
  let fountainChunks: string[] = [];
  let fountainK = 0;
  let seenFountain = new Set<string>(); // dedup

  let rafId = 0;
  let doneFlag = false; // prevent double-processing

  // Manual text input fallback
  let showManual  = $state(false);
  let manualText  = $state('');
  const PASTE_PLACEHOLDER = '<xml ...> oder {type: FeatureCollection...}';
  let manualUrl   = $state('');
  let processing  = $state(false);

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      setStatus('QR-Code in die Kamera halten…', 'info');
      scan();
    } catch (e) {
      setStatus(`Kamera nicht verfügbar: ${e}`, 'err');
    }
  });

  onDestroy(() => stop());

  function stop() {
    scanning = false;
    cancelAnimationFrame(rafId);
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
    fountainChunks = [];
    fountainK = 0;
    seenFountain.clear();
    progress = 0;
    doneFlag = false;
    setStatus('QR-Code in die Kamera halten…', 'info');
  }

  function scan() {
    if (!scanning) return;
    rafId = requestAnimationFrame(async () => {
      if (!video || video.readyState < 2) { scan(); return; }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const jsQR  = (await import('jsqr')).default;
        const code  = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code?.data) await processQrData(code.data);
      } catch { /* jsQR error — continue */ }
      scan();
    });
  }

  // ── Main dispatch ───────────────────────────────────────────────────────────

  async function processQrData(raw: string) {
    if (doneFlag) return;

    // 1. Fountain chunk
    if (isFountainChunk(raw)) {
      if (seenFountain.has(raw)) return;
      seenFountain.add(raw);
      fountainChunks = [...fountainChunks, raw];
      if (fountainK === 0) {
        try { fountainK = (JSON.parse(raw) as { m: { k: number } }).m.k; } catch { /**/ }
      }
      progress = fountainK > 0 ? Math.min(99, (fountainChunks.length / fountainK) * 100) : 0;
      setStatus(`Fountain: ${fountainChunks.length}/${fountainK} Chunks empfangen`, 'progress');

      if (fountainChunks.length >= fountainK) {
        const decoded = decodeFountainChunks(fountainChunks);
        if (decoded) {
          const jsonStr = decompressPayload(decoded);
          await processPayload(jsonStr);
        }
      }
      return;
    }

    // 2. Standard sequential chunk
    const chunk = parseChunkPayload(raw);
    if (chunk) {
      const key = `${chunk.idx}:${chunk.total}:${chunk.data.length}:${chunk.data.slice(0, 20)}`;
      if (seenSeqChunks.has(key)) return;
      seenSeqChunks.add(key);

      if (!chunkBuf) chunkBuf = createChunkBuffer();
      const done = collectChunk(chunk, chunkBuf);
      progress = chunkBuf.total > 0 ? (chunkBuf.chunks.size / chunkBuf.total) * 100 : 0;
      setStatus(`${chunkBuf.chunks.size} / ${chunkBuf.total} Chunks empfangen`, 'progress');

      if (done) {
        const assembled = assembleChunks(chunkBuf);
        const jsonStr   = decompressPayload(assembled);
        await processPayload(jsonStr, chunkBuf.type as string);
        chunkBuf = null;
        progress = 0;
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
          // GMTW Compact format: {v, n, c, col, lats, lngs, eles}
          const decoded = decodeCompactToTrack(jsonStr);
          const gpxStr  = buildGpxFromPoints(decoded.points, decoded.name);
          await tracksStore.loadGpxString(gpxStr, decoded.name, (decoded.cat as TrackCat) || 'custom');
          finish(`✓ Track "${decoded.name}" importiert`, 'ok');
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
          // Simple gmtw-marker format from encodeMarkerQr
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
      setStatus(`Fehler beim Import: ${(e as Error).message}`, 'err');
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
      const { gpxStr, name, cat } = parseAnyFormatToGpx(raw);
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      finish(`✓ Track "${name}" importiert`, 'ok');
      app.toast(`Track "${name}" importiert`, 'success');
    } catch (e) {
      doneFlag = false;
      setStatus(`QR nicht erkannt: ${(e as Error).message}`, 'err');
    }
  }

  async function processUrl(url: string) {
    if (doneFlag) return;
    // Skip Google Maps etc. — only process GPX/GeoJSON/JSON URLs
    const isDataUrl = /\.(gpx|geojson|json)(\?.*)?$/i.test(url);
    if (!isDataUrl) {
      // Could be a maps link or other — ignore silently, keep scanning
      return;
    }
    doneFlag = true;
    setStatus('URL wird geladen…', 'progress');
    try {
      const { gpxStr, name, cat } = await fetchAndParseUrl(url);
      await tracksStore.loadGpxString(gpxStr, name, (cat as TrackCat) || 'custom');
      finish(`✓ Track "${name}" von URL geladen`, 'ok');
      app.toast(`Track "${name}" importiert`, 'success');
    } catch (e) {
      doneFlag = false;
      setStatus(`URL-Fehler: ${(e as Error).message}`, 'err');
    }
  }

  function finish(msg: string, type: 'ok' | 'err') {
    setStatus(msg, type);
    setTimeout(() => { stop(); onstop?.(); }, 1800);
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

  const statusColors: Record<string, string> = {
    info: 'var(--td)',
    ok: '#22c55e',
    err: '#ef4444',
    progress: 'var(--ac)',
  };
</script>

<div style="display:flex;flex-direction:column;gap:0.75rem">

  <!-- Camera viewfinder -->
  <div style="position:relative;border-radius:var(--r2);overflow:hidden;background:#000;aspect-ratio:1">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline autoplay muted
      style="width:100%;height:100%;object-fit:cover"></video>
    <canvas bind:this={canvas} style="display:none"></canvas>

    <!-- Viewfinder frame -->
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
      <div style="
        width:60%;aspect-ratio:1;
        border:3px solid var(--ac);
        border-radius:var(--r);
        opacity:0.85;
        box-shadow:0 0 0 2000px rgba(0,0,0,0.35);
      "></div>
    </div>

    <!-- Progress bar for multi-chunk -->
    {#if progress > 0 && progress < 100}
      <div style="position:absolute;bottom:0;left:0;right:0;height:5px;background:rgba(0,0,0,0.4)">
        <div style="height:100%;background:var(--ac);width:{progress.toFixed(0)}%;transition:width 0.15s"></div>
      </div>
    {/if}

    <!-- Status overlay top -->
    <div style="position:absolute;top:0.5rem;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.65);border-radius:1rem;padding:0.25rem 0.75rem;white-space:nowrap">
      <span style="font-size:0.75rem;color:{statusColors[statusType]};font-family:var(--fh);font-weight:700">
        {status}
      </span>
    </div>
  </div>

  <!-- Chunk progress detail -->
  {#if progress > 0 && progress < 100}
    <div style="background:var(--s2);border-radius:var(--r);padding:0.5rem 0.75rem;display:flex;align-items:center;gap:0.75rem;border:1px solid var(--bd)">
      <div style="flex:1;height:6px;background:var(--bd2);border-radius:3px">
        <div style="height:100%;background:var(--ac);border-radius:3px;width:{progress.toFixed(0)}%;transition:width 0.15s"></div>
      </div>
      <span style="font-family:var(--fh);font-size:0.8rem;color:var(--ac);font-weight:700;white-space:nowrap">
        {progress.toFixed(0)} %
      </span>
      <button class="btn btn-ghost btn-sm" onclick={reset}>↺ Reset</button>
    </div>
  {/if}

  <!-- Action buttons -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
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
