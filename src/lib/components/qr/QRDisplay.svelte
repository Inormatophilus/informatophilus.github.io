<script lang="ts">
  import { QRAnimator } from '$lib/services/qr-engine';
  import type { ActionReturn } from 'svelte/action';

  interface Props {
    chunks: string[];
    fps?: number;
    size?: number;
  }
  let { chunks, fps = 3, size = 280 }: Props = $props();

  let currentIdx = $state(0);
  let playing    = $state(true);

  // The animator is captured inside the action closure — no bind:this needed
  let _anim: QRAnimator | null = null;

  /**
   * Svelte action: runs synchronously after the canvas element is mounted.
   * `update(newChunks)` fires whenever the `chunks` parameter changes.
   * `destroy()` fires when the component unmounts.
   */
  function qrRenderer(node: HTMLCanvasElement, initChunks: string[]): ActionReturn<string[]> {
    const anim = new QRAnimator(fps, size);
    anim.onFrame = (idx) => { currentIdx = idx; };
    _anim = anim;

    if (initChunks.length > 0) {
      currentIdx = 0;
      playing = true;
      anim.start(initChunks, node);
    }

    return {
      update(newChunks: string[]) {
        anim.stop();
        currentIdx = 0;
        playing = true;
        if (newChunks.length > 0) anim.start(newChunks, node);
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
</script>

<div class="qr-canvas-wrap">
  <canvas
    use:qrRenderer={chunks}
    width={size}
    height={size}
    class="qr-canvas"
    style="width:{size}px;height:{size}px;display:block"
  ></canvas>

  {#if chunks.length > 1}
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.4rem">
      <button class="btn-icon btn-sm" onclick={prev} aria-label="Zurück">◀</button>
      <span class="text-sm text-dim">{currentIdx + 1}/{chunks.length}</span>
      <button class="btn-icon btn-sm" onclick={next} aria-label="Weiter">▶</button>
      <button class="btn-icon btn-sm" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
      </button>
    </div>

    <div style="width:{size}px;height:4px;background:var(--s3);border-radius:2px;margin-top:0.25rem">
      <div style="height:100%;background:var(--ac);border-radius:2px;width:{((currentIdx + 1) / chunks.length * 100).toFixed(1)}%;transition:width 0.1s"></div>
    </div>
  {/if}
</div>
