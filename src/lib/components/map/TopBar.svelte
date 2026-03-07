<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { raceEngine } from '$lib/stores/race.svelte';
  import { navigationStore } from '$lib/stores/navigation.svelte';

  interface Props {
    onToggleSheet: () => void;
  }
  let { onToggleSheet }: Props = $props();

  const trackCount  = $derived(tracksStore.tracks.length);
  const isRacing    = $derived(raceEngine.isRacing);
  const isApproach  = $derived(raceEngine.isApproaching);
  const isNavActive = $derived(navigationStore.active);

  // Status dot: racing = red pulse, approaching = amber pulse, nav = green, idle = dim
  const statusColor = $derived(
    isRacing    ? '#ef4444' :
    isApproach  ? '#f59e0b' :
    isNavActive ? '#22c55e' : 'rgba(148,163,184,0.3)'
  );

  const statusPulse = $derived(isRacing || isApproach);
</script>

<div class="topbar" class:topbar-race={isRacing}>
  <!-- ── Left: Track list button ── -->
  <button
    class="tb-btn"
    id="burger-btn"
    onclick={onToggleSheet}
    aria-label="Streckenliste öffnen"
    title="Streckenliste"
  >
    <!-- Modern list icon (3 lines, tapered) -->
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
      <path d="M1 1.5H17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M1 7H13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M1 12.5H17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>
    {#if trackCount > 0}
      <span class="tb-badge">{trackCount}</span>
    {/if}
  </button>

  <!-- ── Center: Title / Race status ── -->
  <div class="tb-center">
    {#if isRacing}
      <!-- Race active: show live timer in title area -->
      <div class="tb-race-strip">
        <span class="tb-race-dot">◉</span>
        <span class="tb-race-label">RACE</span>
        <span class="tb-race-time">{raceEngine.elapsedFormatted}</span>
        <span class="tb-race-sec">S{raceEngine.currentSector}/4</span>
      </div>
    {:else if isApproach}
      <!-- Approaching start -->
      <div class="tb-approach-strip">
        <span class="tb-approach-dot">◉</span>
        <span class="tb-approach-label">ZUM START</span>
        <span class="tb-approach-dist">
          {raceEngine.distToStart === Infinity ? '…' : raceEngine.distToStart.toFixed(0) + 'm'}
        </span>
      </div>
    {:else}
      <!-- Normal title pill -->
      <div class="tb-title-pill">
        <div class="tb-logo">MUNI</div>
        <div class="tb-title-col">
          <div class="tb-title">GMTW Trail Map</div>
          <div class="tb-sub">Hohensyburg · Herdecke</div>
        </div>
        <!-- Activity status dot -->
        <div
          class="tb-status-dot"
          class:tb-dot-pulse={statusPulse}
          style="background:{statusColor}"
          aria-hidden="true"
        ></div>
      </div>
    {/if}
  </div>

  <!-- ── Right: Layer toggle ── -->
  <button
    class="tb-btn"
    id="layer-btn"
    onclick={() => mapStore.toggleLayer()}
    aria-label={mapStore.layer === 'topo' ? 'Satellitenbild anzeigen' : 'Topokarte anzeigen'}
    title={mapStore.layer === 'topo' ? 'Satellit' : 'Topo'}
  >
    {#if mapStore.layer === 'topo'}
      <!-- Layers icon -->
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M9 2L17 6L9 10L1 6L9 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M1 10L9 14L17 10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
    {:else}
      <!-- Globe icon -->
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/>
        <path d="M2 9h14M9 2a11 11 0 010 14M9 2a11 11 0 000 14" stroke="currentColor" stroke-width="1.2" opacity=".55"/>
      </svg>
    {/if}
  </button>
</div>

<style>
/* ── TopBar container ───────────────────────────────────────────────────── */
.topbar {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: var(--z-fab);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;

  background: linear-gradient(
    to bottom,
    rgba(11, 14, 20, 0.97) 60%,
    transparent
  );
  pointer-events: none;
  transition: background 0.4s ease;
}

/* When racing: subtle terminal green tint */
.topbar-race {
  background: linear-gradient(
    to bottom,
    rgba(3, 10, 3, 0.97) 60%,
    transparent
  );
}

.topbar > * { pointer-events: auto; }

/* ── Icon buttons ───────────────────────────────────────────────────────── */
.tb-btn {
  background: rgba(28, 34, 48, 0.85);
  border: 1px solid rgba(61, 79, 96, 0.7);
  border-radius: 12px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(226, 232, 240, 0.8);
  flex-shrink: 0;
  position: relative;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
  backdrop-filter: blur(8px);
}

.tb-btn:hover { background: rgba(38, 48, 61, 0.9); border-color: rgba(200, 255, 0, 0.25); }
.tb-btn:active { transform: scale(0.93); }

.tb-badge {
  position: absolute;
  top: -4px; right: -4px;
  background: #c8ff00;
  color: #000;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 800;
  border-radius: 8px;
  min-width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  box-shadow: 0 0 6px rgba(200, 255, 0, 0.4);
}

/* ── Center area ────────────────────────────────────────────────────────── */
.tb-center {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Normal title pill ──────────────────────────────────────────────────── */
.tb-title-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(28, 34, 48, 0.85);
  border: 1px solid rgba(61, 79, 96, 0.7);
  border-radius: 14px;
  padding: 5px 10px 5px 8px;
  max-width: 260px;
  width: 100%;
  backdrop-filter: blur(8px);
}

.tb-logo {
  background: #c8ff00;
  color: #000;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.05em;
  border-radius: 6px;
  padding: 2px 6px;
  flex-shrink: 0;
}

.tb-title-col {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.tb-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: rgba(226, 232, 240, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tb-sub {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: rgba(148, 163, 184, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.02em;
}

.tb-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.4s;
}

.tb-dot-pulse {
  animation: dot-pulse 0.8s ease infinite;
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
}

/* ── Race strip (replaces title when racing) ────────────────────────────── */
.tb-race-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(3, 10, 3, 0.9);
  border: 1px solid rgba(200, 255, 0, 0.4);
  border-radius: 14px;
  padding: 5px 12px;
  max-width: 260px;
  width: 100%;
  backdrop-filter: blur(8px);
  box-shadow: 0 0 12px rgba(200, 255, 0, 0.12);

  /* Scanline micro-texture */
  background-image: repeating-linear-gradient(
    0deg, transparent 0px, transparent 3px,
    rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px
  );
}

.tb-race-dot {
  font-size: 9px;
  color: #ef4444;
  text-shadow: 0 0 6px rgba(239, 68, 68, 0.8);
  animation: dot-pulse 0.6s ease infinite;
  flex-shrink: 0;
}

.tb-race-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 2px;
  color: rgba(200, 255, 0, 0.55);
  text-transform: uppercase;
  flex-shrink: 0;
}

.tb-race-time {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.1rem;
  font-weight: 900;
  color: #c8ff00;
  letter-spacing: 0.02em;
  text-shadow: 0 0 10px rgba(200, 255, 0, 0.5);
  flex: 1;
  text-align: center;
  animation: tb-flicker 6s ease infinite;
}

@keyframes tb-flicker {
  0%, 93%, 97%, 100% { opacity: 1; }
  95% { opacity: 0.7; }
  96% { opacity: 0.4; }
}

.tb-race-sec {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: rgba(200, 255, 0, 0.4);
  flex-shrink: 0;
}

/* ── Approach strip ─────────────────────────────────────────────────────── */
.tb-approach-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(20, 12, 3, 0.9);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 14px;
  padding: 5px 12px;
  max-width: 260px;
  width: 100%;
  backdrop-filter: blur(8px);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.1);
}

.tb-approach-dot {
  font-size: 9px;
  color: #f59e0b;
  text-shadow: 0 0 6px rgba(245, 158, 11, 0.7);
  animation: dot-pulse 1s ease infinite;
  flex-shrink: 0;
}

.tb-approach-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 2px;
  color: rgba(245, 158, 11, 0.6);
  text-transform: uppercase;
  flex-shrink: 0;
}

.tb-approach-dist {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.1rem;
  font-weight: 900;
  color: #f59e0b;
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.4);
  flex: 1;
  text-align: center;
}
</style>
