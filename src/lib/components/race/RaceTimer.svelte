<script lang="ts">
  import { raceEngine } from '$lib/stores/race.svelte';
  import { formatSplitMs } from '$lib/services/geo';

  const NUM_SECTORS = 4;

  // Phosphor color: amber if falls, neon green if clean
  const glow = $derived(raceEngine.fallEvents.length > 0 ? '#f59e0b' : '#c8ff00');

  function parsems(ms: number) {
    const m  = String(Math.floor(ms / 60000)).padStart(2, '0');
    const s  = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    const cs = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
    return { m, s, cs };
  }

  const parts = $derived(parsems(raceEngine.elapsedMs));

  function sectorStatus(i: number): 'done' | 'current' | 'pending' {
    if (i < raceEngine.splits.length)                                          return 'done';
    if (i === raceEngine.splits.length && raceEngine.state === 'racing')       return 'current';
    return 'pending';
  }

  function sectorFill(i: number): string {
    const status = sectorStatus(i);
    if (status === 'done')    return '████';
    if (status === 'current') return '▓▓░░';
    return '░░░░';
  }
</script>

<!-- Fallout Terminal Race HUD — top-center below filter chips -->
<div class="rthud" role="timer" aria-live="off">
  <!-- CRT Scanlines -->
  <div class="rt-scanlines" aria-hidden="true"></div>

  <!-- GO! flash fires once on mount (= race start) -->
  <div class="rt-go-flash" aria-hidden="true">GO!</div>

  <!-- ── Header ── -->
  <div class="rt-header">
    <span class="rt-badge">[RACE&nbsp;ACTIVE]</span>
    <span class="rt-sec-badge">SEKTOR&nbsp;{raceEngine.currentSector}/4</span>
    {#if raceEngine.fallEvents.length > 0}
      <span class="rt-fall-ind">
        ⚠&nbsp;{raceEngine.fallEvents.length}&nbsp;EVENT{raceEngine.fallEvents.length > 1 ? 'S' : ''}
      </span>
    {/if}
  </div>

  <!-- ── Timer + speed ── -->
  <div class="rt-main-row">
    <div
      class="rt-timer"
      style="color:{glow};text-shadow:0 0 14px {glow}99,0 0 30px {glow}44"
    >
      <span class="rt-d">{parts.m}</span>
      <span class="rt-sep">:</span>
      <span class="rt-d">{parts.s}</span>
      <span class="rt-dot">.</span>
      <span class="rt-cs">{parts.cs}</span>
    </div>

    <div class="rt-right-col">
      {#if raceEngine.lastSpeedKmh > 0.5}
        <div class="rt-speed">
          <span class="rt-spd-v">{raceEngine.lastSpeedKmh.toFixed(1)}</span>
          <span class="rt-spd-u">km/h</span>
        </div>
      {/if}
      {#if raceEngine.btConnected}
        <span class="rt-bt">◉&nbsp;BT</span>
      {/if}
    </div>
  </div>

  <!-- ── Sector progress ── -->
  <div class="rt-sectors">
    {#each Array(NUM_SECTORS) as _, i}
      {@const status = sectorStatus(i)}
      <div class="rt-sec" data-s={status} title="Sektor {i+1}">
        <span
          class="rt-sec-fill"
          style={status === 'done' ? `color:${glow}` : ''}
        >{sectorFill(i)}</span>
        {#if status === 'done'}
          <span class="rt-sec-time">{formatSplitMs(raceEngine.splits[i])}</span>
        {:else}
          <span class="rt-sec-num">S{i+1}</span>
        {/if}
      </div>
    {/each}
  </div>

  <!-- ── Fall events ── -->
  {#if raceEngine.fallEvents.length > 0}
    <div class="rt-events">
      {#each raceEngine.fallEvents as ev}
        <span class="rt-ev" class:rt-ev-fall={ev.type === 'fall'}>
          {ev.type === 'fall' ? '⚠FALL' : '⬇DIS'}&nbsp;@{(ev.ts / 1000).toFixed(1)}s
        </span>
      {/each}
    </div>
  {/if}

  <!-- ── Controls ── -->
  <div class="rt-controls">
    <button
      class="rtbtn rtbtn-dis"
      onclick={() => raceEngine.recordFall('dismount')}
      title="Absteiger registrieren"
      aria-label="Absteiger"
    >⬇&nbsp;DIS</button>

    <button
      class="rtbtn rtbtn-fall"
      onclick={() => raceEngine.recordFall('fall')}
      title="Sturz registrieren"
      aria-label="Sturz"
    >⚠&nbsp;FALL</button>

    <button
      class="rtbtn rtbtn-esc"
      onclick={() => raceEngine.reset()}
      title="Rennen abbrechen"
      aria-label="Abbrechen"
    >[ESC]</button>
  </div>
</div>

<style>
/* ── Container ──────────────────────────────────────────────────────────── */
.rthud {
  position: fixed;
  top: 106px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 250;
  width: min(420px, calc(100vw - 12px));

  background: rgba(3, 7, 3, 0.96);
  border: 1px solid rgba(200, 255, 0, 0.4);
  border-radius: 8px;
  overflow: hidden;

  box-shadow:
    0 0 0 1px rgba(200, 255, 0, 0.08),
    0 0 24px rgba(200, 255, 0, 0.16),
    0 8px 32px rgba(0, 0, 0, 0.8);

  animation: rt-slidein 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes rt-slidein {
  from { opacity: 0; transform: translateX(-50%) translateY(-18px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── CRT Scanlines ──────────────────────────────────────────────────────── */
.rt-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px,   transparent 3px,
    rgba(0,0,0,0.13)   3px, rgba(0,0,0,0.13) 4px
  );
  pointer-events: none;
  z-index: 5;
}

/* ── GO! flash — one-shot on mount ─────────────────────────────────────── */
.rt-go-flash {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 3.5rem;
  font-weight: 900;
  color: #c8ff00;
  letter-spacing: 0.12em;
  pointer-events: none;
  text-shadow: 0 0 40px rgba(200,255,0,0.9), 0 0 80px rgba(200,255,0,0.4);
  animation: rt-go 1.4s cubic-bezier(0.4, 0, 0.6, 1) forwards;
}

@keyframes rt-go {
  0%   { opacity: 1; transform: scale(0.8); }
  25%  { opacity: 1; transform: scale(1.15); }
  70%  { opacity: 0.7; transform: scale(1.1); }
  100% { opacity: 0; transform: scale(1.6); }
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.rt-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 3px;
  border-bottom: 1px solid rgba(200, 255, 0, 0.09);
}

.rt-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(200, 255, 0, 0.7);
  animation: rt-flicker 7s ease infinite;
}

.rt-sec-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(200, 255, 0, 0.4);
  text-transform: uppercase;
}

.rt-fall-ind {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #f59e0b;
  text-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
  text-transform: uppercase;
  margin-left: auto;
  animation: rt-alert 0.7s ease infinite;
}

@keyframes rt-alert {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

@keyframes rt-flicker {
  0%, 92%, 96%, 100% { opacity: 1; }
  94% { opacity: 0.7; }
  95% { opacity: 0.3; }
}

/* ── Main timer row ─────────────────────────────────────────────────────── */
.rt-main-row {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  padding: 6px 10px 2px;
  gap: 8px;
}

.rt-timer {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  animation: rt-flicker 7s ease infinite;
}

.rt-d {
  font-size: 2.8rem;
  line-height: 1;
  letter-spacing: -0.02em;
}

.rt-sep {
  font-size: 2.4rem;
  line-height: 1;
  opacity: 0.65;
  margin: 0 1px;
  animation: rt-blink 1s step-end infinite;
}

@keyframes rt-blink {
  0%, 100% { opacity: 0.65; }
  50%       { opacity: 0.15; }
}

.rt-dot {
  font-size: 1.8rem;
  line-height: 1;
  opacity: 0.45;
  margin: 0 1px;
}

.rt-cs {
  font-size: 1.8rem;
  line-height: 1;
  opacity: 0.75;
  min-width: 2ch;
}

/* ── Right column ────────────────────────────────────────────────────────── */
.rt-right-col {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 56px;
}

.rt-speed {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.rt-spd-v {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.05rem;
  font-weight: 800;
  color: #94a3b8;
  line-height: 1;
}

.rt-spd-u {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  color: rgba(148, 163, 184, 0.55);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.rt-bt {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 7px;
  font-weight: 700;
  color: #22c55e;
  letter-spacing: 0.5px;
  text-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}

/* ── Sectors ────────────────────────────────────────────────────────────── */
.rt-sectors {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 3px;
  padding: 4px 10px;
}

.rt-sec {
  flex: 1;
  height: 24px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
  transition: border-color 0.3s, background 0.3s;
}

.rt-sec[data-s="done"] {
  background: rgba(200, 255, 0, 0.10);
  border-color: rgba(200, 255, 0, 0.35);
}

.rt-sec[data-s="current"] {
  background: rgba(200, 255, 0, 0.05);
  border-color: rgba(200, 255, 0, 0.5);
  animation: rt-sec-blink 0.85s ease infinite;
}

@keyframes rt-sec-blink {
  0%, 100% { border-color: rgba(200, 255, 0, 0.55); }
  50%       { border-color: rgba(200, 255, 0, 0.12); }
}

.rt-sec-fill {
  font-family: 'Courier New', monospace;
  font-size: 8px;
  color: rgba(200, 255, 0, 0.22);
  letter-spacing: -1px;
}

.rt-sec[data-s="current"] .rt-sec-fill {
  color: rgba(200, 255, 0, 0.65);
  animation: rt-cur-fill 0.85s ease infinite;
}

@keyframes rt-cur-fill {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

.rt-sec-time {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.3px;
}

.rt-sec-num {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.2);
}

/* ── Fall events ────────────────────────────────────────────────────────── */
.rt-events {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 0 10px 3px;
}

.rt-ev {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 3px;
  padding: 2px 5px;
}

.rt-ev-fall {
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.07);
  text-shadow: 0 0 6px rgba(245, 158, 11, 0.35);
}

/* ── Controls ───────────────────────────────────────────────────────────── */
.rt-controls {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 4px;
  padding: 4px 10px 8px;
  border-top: 1px solid rgba(200, 255, 0, 0.07);
}

.rtbtn {
  flex: 1;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 6px 4px;
  border-radius: 4px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.4);
  transition: background 0.12s, transform 0.1s;
}
.rtbtn:active { transform: scale(0.93); }

.rtbtn-dis {
  color: rgba(245, 158, 11, 0.8);
  border-color: rgba(245, 158, 11, 0.24);
}
.rtbtn-dis:active { background: rgba(245, 158, 11, 0.1); }

.rtbtn-fall {
  color: rgba(239, 68, 68, 0.8);
  border-color: rgba(239, 68, 68, 0.24);
}
.rtbtn-fall:active { background: rgba(239, 68, 68, 0.1); }

.rtbtn-esc {
  flex: 0.6;
  color: rgba(255, 255, 255, 0.3);
  font-size: 9px;
}
</style>
