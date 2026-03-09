<script lang="ts">
  import { QRAnimator } from '$lib/services/qr-engine';
  import type { ActionReturn } from 'svelte/action';

  interface Props {
    chunks: string[];
    fps?: number;
    size?: number;
  }
  let { chunks, fps = 2.5, size = 340 }: Props = $props();

  let currentIdx = $state(0);
  let playing    = $state(true);
  let chunkMeta  = $state<{ first?: boolean; last?: boolean; name?: string } | null>(null);

  let _anim: QRAnimator | null = null;

  /**
   * Svelte action: runs synchronously after the canvas element is mounted.
   * `update(newChunks)` fires whenever the `chunks` parameter changes.
   * `destroy()` fires when the component unmounts.
   */
  function qrRenderer(node: HTMLCanvasElement, initChunks: string[]): ActionReturn<string[]> {
    const anim = new QRAnimator(fps, size);
    anim.onFrame = (idx) => {
      currentIdx = idx;
      chunkMeta = anim.currentChunkMeta;
    };
    _anim = anim;

    if (initChunks.length > 0) {
      currentIdx = 0;
      playing = true;
      anim.start(initChunks, node);
      chunkMeta = anim.currentChunkMeta;
    }

    return {
      update(newChunks: string[]) {
        anim.stop();
        currentIdx = 0;
        playing = true;
        if (newChunks.length > 0) {
          anim.start(newChunks, node);
          chunkMeta = anim.currentChunkMeta;
        }
      },
      destroy() {
        anim.stop();
        _anim = null;
      },
    };
  }

  function togglePlay() {
    if (!_anim) return;
    if (playing) { _anim.stop(); playing = false; }
    else { _anim.resume(); playing = true; }
  }
  function prev()  { _anim?.prev(); }
  function next()  { _anim?.next(); }

  // Chunk label berechnen
  let chunkLabel = $derived.by(() => {
    if (chunks.length <= 1) return '';
    const num = currentIdx + 1;
    const total = chunks.length;
    if (num === 1 && total > 1) return `QR 1 von ${total} — START`;
    if (num === total) return `QR ${num} von ${total} — LETZTER`;
    return `QR ${num} von ${total}`;
  });
</script>

<div class="qr-display-wrap">
  <!-- Chunk-Name wenn vorhanden -->
  {#if chunkMeta?.name && chunks.length > 1}
    <div class="qr-track-name">{chunkMeta.name}</div>
  {/if}

  <!-- Chunk-Position Label (prominent) -->
  {#if chunks.length > 1}
    <div class="qr-chunk-label" class:qr-chunk-first={currentIdx === 0} class:qr-chunk-last={currentIdx === chunks.length - 1}>
      {chunkLabel}
    </div>
  {/if}

  <!-- QR Canvas -->
  <div class="qr-canvas-container" style="max-width:{size}px">
    <canvas
      use:qrRenderer={chunks}
      width={size}
      height={size}
      class="qr-canvas"
    ></canvas>
  </div>

  {#if chunks.length > 1}
    <!-- Controls -->
    <div class="qr-controls">
      <button class="qr-ctrl-btn" onclick={prev} aria-label="Zurück">◀</button>
      <button class="qr-ctrl-btn qr-ctrl-play" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
      </button>
      <button class="qr-ctrl-btn" onclick={next} aria-label="Weiter">▶</button>
    </div>

    <!-- Progress bar -->
    <div class="qr-progress-track">
      <!-- Individual segment indicators -->
      {#each Array(chunks.length) as _, i}
        <div
          class="qr-progress-seg"
          class:qr-seg-active={i === currentIdx}
          class:qr-seg-done={i < currentIdx}
        ></div>
      {/each}
    </div>

    <!-- Info -->
    <div class="qr-info">
      Halte das Gerät ruhig vor die Kamera.<br>
      Alle {chunks.length} QR-Codes werden automatisch gescannt.
    </div>
  {:else}
    <div class="qr-info">Einzel-QR-Code — einmal scannen genügt.</div>
  {/if}
</div>

<style>
  .qr-display-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .qr-track-name {
    font-family: var(--fh);
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--tx);
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qr-chunk-label {
    font-family: var(--fh);
    font-weight: 800;
    font-size: 0.95rem;
    padding: 0.25rem 0.75rem;
    border-radius: 2rem;
    background: var(--s2);
    color: var(--tx);
    border: 2px solid var(--bd);
    text-align: center;
    letter-spacing: 0.02em;
  }

  .qr-chunk-first {
    background: rgba(200, 255, 0, 0.15);
    border-color: var(--ac);
    color: var(--ac);
  }

  .qr-chunk-last {
    background: rgba(34, 197, 94, 0.15);
    border-color: #22c55e;
    color: #22c55e;
  }

  .qr-canvas-container {
    background: #fff;
    border-radius: 12px;
    padding: 8px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .qr-canvas {
    display: block;
    width: 100%;
    height: auto;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
  }

  .qr-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .qr-ctrl-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 2px solid var(--bd);
    background: var(--s2);
    color: var(--tx);
    font-size: 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .qr-ctrl-btn:active {
    background: var(--ac);
    color: var(--bg);
    border-color: var(--ac);
  }

  .qr-ctrl-play {
    width: 42px;
    height: 42px;
    font-size: 1.1rem;
    border-color: var(--ac);
  }

  .qr-progress-track {
    display: flex;
    gap: 2px;
    width: 100%;
    max-width: 340px;
    height: 6px;
  }

  .qr-progress-seg {
    flex: 1;
    height: 100%;
    background: var(--s3);
    border-radius: 3px;
    transition: background 0.15s;
  }

  .qr-seg-active {
    background: var(--ac);
    box-shadow: 0 0 4px var(--ac);
  }

  .qr-seg-done {
    background: color-mix(in srgb, var(--ac) 40%, var(--s3));
  }

  .qr-info {
    font-size: 0.72rem;
    color: var(--td);
    text-align: center;
    line-height: 1.4;
    max-width: 280px;
  }
</style>
