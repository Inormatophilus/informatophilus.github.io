<script lang="ts">
  import { navigationStore } from '$lib/stores/navigation.svelte';
  import { raceEngine } from '$lib/stores/race.svelte';

  // Drop below RaceTimer when racing (~106px start + ~108px height + 4px gap)
  const topPx = $derived(raceEngine.isRacing ? 226 : 106);

  const turnIcon = $derived(
    navigationStore.turnIndicator === 'left'  ? '↰' :
    navigationStore.turnIndicator === 'right' ? '↱' : '↑'
  );

  const turnLabel = $derived(
    navigationStore.turnIndicator === 'left'  ? 'LINKS'  :
    navigationStore.turnIndicator === 'right' ? 'RECHTS' : 'AHEAD'
  );

  const xteAbs   = $derived(Math.abs(navigationStore.xte));
  const xteColor = $derived(
    xteAbs < 3  ? '#c8ff00' :
    xteAbs < 10 ? '#f59e0b' : '#ef4444'
  );
  const xtePct = $derived(
    Math.max(5, Math.min(95, 50 + (navigationStore.xte / 30) * 45))
  );
  const pct = $derived(Math.round(navigationStore.progress * 100));
</script>

{#if navigationStore.active}
<div
  class="nav-hud"
  style="top:{topPx}px"
  role="status"
  aria-label="Navigation HUD"
  aria-live="polite"
>
  <!-- Scanline overlay -->
  <div class="nav-scanlines" aria-hidden="true"></div>

  <!-- Corner brackets (Fallout terminal aesthetic) -->
  <span class="nav-corner tl" aria-hidden="true">┌</span>
  <span class="nav-corner tr" aria-hidden="true">┐</span>
  <span class="nav-corner bl" aria-hidden="true">└</span>
  <span class="nav-corner br" aria-hidden="true">┘</span>

  <!-- Turn direction indicator -->
  <div class="nav-turn" data-dir={navigationStore.turnIndicator}>
    <span class="nav-turn-icon">{turnIcon}</span>
    <span class="nav-turn-lbl">{turnLabel}</span>
  </div>

  <div class="nav-divider" aria-hidden="true"></div>

  <!-- Distance to next waypoint -->
  <div class="nav-dist-block">
    <span class="nav-dist-val">{navigationStore.distFormatted}</span>
    <span class="nav-dist-lbl">TO&nbsp;NEXT</span>
  </div>

  <div class="nav-divider" aria-hidden="true"></div>

  <!-- Cross-Track Error bar -->
  <div class="nav-xte-block" title="Spurabweichung: {navigationStore.xteFormatted}">
    <div class="nav-xte-bar">
      <div class="nav-xte-center" aria-hidden="true"></div>
      <div
        class="nav-xte-dot"
        style="left:{xtePct.toFixed(1)}%;background:{xteColor};box-shadow:0 0 5px {xteColor}88"
        aria-hidden="true"
      ></div>
    </div>
    {#if xteAbs > 1}
      <span class="nav-xte-lbl" style="color:{xteColor}">
        {xteAbs.toFixed(0)}m&nbsp;{navigationStore.xte > 0 ? 'R' : 'L'}
      </span>
    {:else}
      <span class="nav-xte-lbl" style="color:#c8ff00">ON&nbsp;TRACK</span>
    {/if}
  </div>

  <div class="nav-divider" aria-hidden="true"></div>

  <!-- Track progress -->
  <div class="nav-prog-block">
    <div
      class="nav-prog-bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div class="nav-prog-fill" style="width:{pct}%"></div>
    </div>
    <span class="nav-prog-lbl">{pct}%</span>
  </div>

  <!-- Stop button -->
  <button
    class="nav-stop"
    onclick={() => navigationStore.stop()}
    aria-label="Navigation beenden"
    title="Navigation beenden"
  >✕</button>
</div>
{/if}

<style>
/* ── Container ──────────────────────────────────────────────────────────── */
.nav-hud {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: 240;
  width: min(480px, calc(100vw - 12px));

  display: flex;
  align-items: center;
  padding: 7px 10px;

  background: rgba(3, 7, 3, 0.95);
  border: 1px solid rgba(200, 255, 0, 0.35);
  border-radius: 6px;
  overflow: visible;

  box-shadow:
    0 0 0 1px rgba(200, 255, 0, 0.07),
    0 0 18px rgba(200, 255, 0, 0.12),
    0 6px 28px rgba(0, 0, 0, 0.75);

  transition: top 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  animation: nav-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes nav-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-14px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Scanlines ──────────────────────────────────────────────────────────── */
.nav-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px, transparent 3px,
    rgba(0, 0, 0, 0.10) 3px, rgba(0, 0, 0, 0.10) 4px
  );
  pointer-events: none;
  border-radius: inherit;
}

/* ── Corner brackets ────────────────────────────────────────────────────── */
.nav-corner {
  position: absolute;
  font-family: 'Courier New', monospace;
  font-size: 9px;
  color: rgba(200, 255, 0, 0.3);
  line-height: 1;
  pointer-events: none;
  z-index: 2;
}
.tl { top: -1px;    left: 1px;  }
.tr { top: -1px;    right: 1px; }
.bl { bottom: -1px; left: 1px;  }
.br { bottom: -1px; right: 1px; }

/* ── Divider ────────────────────────────────────────────────────────────── */
.nav-divider {
  width: 1px;
  height: 28px;
  background: rgba(200, 255, 0, 0.15);
  flex-shrink: 0;
  margin: 0 8px;
}

/* ── Turn indicator ─────────────────────────────────────────────────────── */
.nav-turn {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 40px;
}

.nav-turn-icon {
  font-size: 1.45rem;
  line-height: 1;
  color: #c8ff00;
  text-shadow: 0 0 10px rgba(200, 255, 0, 0.65);
}

.nav-turn[data-dir="left"]  .nav-turn-icon,
.nav-turn[data-dir="right"] .nav-turn-icon {
  animation: turn-pulse 1.1s ease infinite;
}

@keyframes turn-pulse {
  0%, 100% { text-shadow: 0 0 10px rgba(200,255,0,0.65); }
  50%       { text-shadow: 0 0 22px rgba(200,255,0,1), 0 0 40px rgba(200,255,0,0.4); }
}

.nav-turn-lbl {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 1.2px;
  color: rgba(200, 255, 0, 0.5);
  text-transform: uppercase;
}

/* ── Distance block ─────────────────────────────────────────────────────── */
.nav-dist-block {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nav-dist-val {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.35rem;
  font-weight: 900;
  color: #c8ff00;
  line-height: 1;
  text-shadow: 0 0 10px rgba(200, 255, 0, 0.5);
  letter-spacing: 0.02em;
}

.nav-dist-lbl {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(200, 255, 0, 0.4);
  text-transform: uppercase;
}

/* ── XTE block ──────────────────────────────────────────────────────────── */
.nav-xte-block {
  flex: 1;
  min-width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.nav-xte-bar {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.nav-xte-center {
  position: absolute;
  left: 50%;
  top: -1px;
  bottom: -1px;
  width: 1px;
  background: rgba(200, 255, 0, 0.25);
}

.nav-xte-dot {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: left 0.45s ease;
}

.nav-xte-lbl {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* ── Progress block ─────────────────────────────────────────────────────── */
.nav-prog-block {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 36px;
}

.nav-prog-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.nav-prog-fill {
  height: 100%;
  background: #c8ff00;
  border-radius: 2px;
  transition: width 0.9s ease;
  box-shadow: 0 0 6px rgba(200, 255, 0, 0.45);
}

.nav-prog-lbl {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 700;
  color: rgba(200, 255, 0, 0.5);
  letter-spacing: 0.5px;
}

/* ── Stop button ────────────────────────────────────────────────────────── */
.nav-stop {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: rgba(239, 68, 68, 0.55);
  font-size: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.nav-stop:hover {
  background: rgba(239, 68, 68, 0.18);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.5);
}
</style>
