<script lang="ts">
  import { raceEngine } from '$lib/stores/race.svelte';

  // ── Color interpolation (amber 100m → lime at line) ─────────────────────
  const bgGlow = $derived((): string => {
    const d = raceEngine.distToStart;
    if (d === Infinity || d > 100) return 'transparent';
    if (d <= 2)  return 'rgba(200,255,0,0.12)';
    if (d <= 5)  return 'rgba(200,255,0,0.07)';
    if (d <= 15) {
      const t = (d - 5) / 10;
      return `rgba(${Math.round(200 + t * 45)},${Math.round(255 - t * 97)},0,${(0.14 - t * 0.05).toFixed(3)})`;
    }
    const t = (d - 15) / 85;
    return `rgba(245,158,11,${(0.10 * (1 - t)).toFixed(3)})`;
  });

  const distColor = $derived(
    raceEngine.distToStart <= 2  ? '#c8ff00' :
    raceEngine.distToStart <= 5  ? '#a8e600' :
    raceEngine.distToStart <= 15 ? '#f59e0b' :
    raceEngine.distToStart <= 40 ? '#fb923c' : '#94a3b8'
  );

  const barFilled = $derived(
    Math.round(Math.max(0, Math.min(100, (1 - raceEngine.distToStart / 100) * 100)) / 100 * 16)
  );
  const barStr = $derived('█'.repeat(barFilled) + '░'.repeat(16 - barFilled));

  const isAtLine = $derived(raceEngine.state === 'at_line');
  const isArmed  = $derived(isAtLine && raceEngine.armed);
  const isClose  = $derived(raceEngine.distToStart <= 2);

  const statusText = $derived(
    isArmed && isClose ? 'ARMED — AUTO-START AKTIV'  :
    isArmed            ? 'ARMED — WEITER ZUR LINIE'  :
    isAtLine           ? 'AN DER STARTLINIE'          :
    raceEngine.distToStart < 50 ? 'ANNÄHERUNG ERKANNT' :
    'NAVIGATION ZUM START'
  );

  const speedStr = $derived(
    raceEngine.lastSpeedKmh > 0.5 ? `${raceEngine.lastSpeedKmh.toFixed(1)} KM/H` : ''
  );

  const visible = $derived(
    raceEngine.distToStart < 120 || raceEngine.state === 'at_line'
  );
</script>

{#if visible}
  <!-- Full-screen phosphor background glow -->
  <div
    class="ap-bg"
    class:ap-bg-armed={isArmed}
    style="background:{bgGlow()}"
    aria-hidden="true"
  ></div>

  <!-- Fallout terminal approach panel — slides up from bottom -->
  <div
    class="ap-panel"
    class:ap-panel-armed={isArmed}
    role="status"
    aria-label="Startlinien-Annäherung"
    aria-live="polite"
  >
    <!-- CRT scanlines -->
    <div class="ap-scanlines" aria-hidden="true"></div>

    <!-- Corner brackets -->
    <span class="ap-corner tl" aria-hidden="true">┌─</span>
    <span class="ap-corner tr" aria-hidden="true">─┐</span>
    <span class="ap-corner bl" aria-hidden="true">└─</span>
    <span class="ap-corner br" aria-hidden="true">─┘</span>

    <!-- System header -->
    <div class="ap-sys-header">
      <span class="ap-sys-tag">GMTW&nbsp;RACE&nbsp;SYSTEM</span>
      <span class="ap-sys-ver">v2.6</span>
      <span class="ap-sys-dot" class:green={isArmed}>◉</span>
    </div>

    <!-- Main distance display -->
    <div class="ap-dist-section">
      <div class="ap-dist-label">DISTANZ ZUR STARTLINIE</div>
      <div
        class="ap-dist-val"
        style="color:{distColor};text-shadow:0 0 18px {distColor}88,0 0 40px {distColor}33"
      >
        {#if isClose}
          <span class="ap-at-line">AN&nbsp;DER&nbsp;LINIE</span>
        {:else}
          <span class="ap-dist-num">{raceEngine.distToStart.toFixed(1)}</span>
          <span class="ap-dist-unit">m</span>
        {/if}
      </div>
      {#if speedStr}
        <div class="ap-speed">{speedStr}</div>
      {/if}
    </div>

    <!-- ASCII progress bar -->
    <div class="ap-bar-section">
      <div class="ap-bar-row" aria-hidden="true">
        <span class="ap-bar-bracket">[</span>
        <span class="ap-bar-fill" style="color:{distColor}">{barStr}</span>
        <span class="ap-bar-bracket">]</span>
        <span class="ap-bar-pct">{Math.round(Math.max(0,(1-raceEngine.distToStart/100)*100))}%</span>
      </div>
    </div>

    <!-- Status line -->
    <div class="ap-status" class:ap-status-armed={isArmed}>
      {#if isArmed}
        <span class="ap-blink">▶&nbsp;{statusText}</span>
      {:else}
        {statusText}
      {/if}
    </div>

    <!-- Action buttons -->
    <div class="ap-actions">
      {#if isAtLine && !raceEngine.armed}
        <button
          class="ap-btn ap-btn-arm"
          onclick={() => raceEngine.arm()}
          aria-label="Rennen scharf schalten"
        >⚡&nbsp;SCHARF&nbsp;SCHALTEN</button>
      {:else if isArmed}
        <div class="ap-armed-msg">
          <span class="ap-arm-icon">⚡</span>
          <span>Überfahre die Linie — Start automatisch</span>
        </div>
      {/if}

      <div class="ap-row-btns">
        {#if raceEngine.btConnected}
          <div class="ap-ble-ok">
            <span class="ap-ble-dot">◉</span>&nbsp;Smartwatch&nbsp;aktiv
          </div>
        {:else}
          <button
            class="ap-btn ap-btn-ble"
            onclick={() => raceEngine.connectWatch()}
            aria-label="Smartwatch verbinden"
          >📡&nbsp;SMARTWATCH</button>
        {/if}
        <button
          class="ap-btn ap-btn-abort"
          onclick={() => raceEngine.reset()}
          aria-label="Abbrechen"
        >[ABBRUCH]</button>
      </div>
    </div>
  </div>
{/if}

<style>
/* ── Background glow ────────────────────────────────────────────────────── */
.ap-bg {
  position: fixed;
  inset: 0;
  z-index: 198;
  pointer-events: none;
  transition: background 0.5s ease;
}
.ap-bg-armed { animation: bg-pulse 1s ease infinite; }
@keyframes bg-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

/* ── Panel ──────────────────────────────────────────────────────────────── */
.ap-panel {
  position: fixed;
  bottom: 5.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 210;
  width: min(340px, calc(100vw - 16px));

  background: rgba(3, 7, 3, 0.97);
  border: 1px solid rgba(200, 255, 0, 0.35);
  border-radius: 10px;
  overflow: visible;
  padding: 12px 16px 14px;

  box-shadow:
    0 0 0 1px rgba(200,255,0,0.07),
    0 0 28px rgba(200,255,0,0.16),
    0 -4px 32px rgba(0,0,0,0.7),
    0 12px 40px rgba(0,0,0,0.7);

  animation: ap-in 0.35s cubic-bezier(0.16,1,0.3,1) both;
}

@keyframes ap-in {
  from { opacity:0; transform:translateX(-50%) translateY(22px); }
  to   { opacity:1; transform:translateX(-50%) translateY(0); }
}

.ap-panel-armed {
  border-color: rgba(200,255,0,0.65);
  box-shadow:
    0 0 0 1px rgba(200,255,0,0.15),
    0 0 40px rgba(200,255,0,0.22),
    0 12px 40px rgba(0,0,0,0.7);
  animation: ap-in 0.35s cubic-bezier(0.16,1,0.3,1) both, ap-border 1s ease infinite;
}
@keyframes ap-border { 0%,100%{border-color:rgba(200,255,0,0.7)} 50%{border-color:rgba(200,255,0,0.2)} }

/* ── Scanlines ──────────────────────────────────────────────────────────── */
.ap-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px, transparent 3px,
    rgba(0,0,0,0.11) 3px, rgba(0,0,0,0.11) 4px
  );
  pointer-events: none;
  border-radius: inherit;
}

/* ── Corners ────────────────────────────────────────────────────────────── */
.ap-corner {
  position: absolute;
  font-family: 'Courier New', monospace;
  font-size: 10px;
  color: rgba(200,255,0,0.32);
  line-height: 1;
  pointer-events: none;
}
.tl{top:-1px;left:1px} .tr{top:-1px;right:1px} .bl{bottom:-1px;left:1px} .br{bottom:-1px;right:1px}

/* ── System header ──────────────────────────────────────────────────────── */
.ap-sys-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(200,255,0,0.09);
}
.ap-sys-tag {
  font-family:'Barlow Condensed',sans-serif;
  font-size:8px; font-weight:800; letter-spacing:2px;
  color:rgba(200,255,0,0.55); text-transform:uppercase;
}
.ap-sys-ver {
  font-family:'Courier New',monospace;
  font-size:8px; color:rgba(200,255,0,0.3);
}
.ap-sys-dot {
  margin-left:auto; font-size:10px;
  color:rgba(245,158,11,0.7);
  animation: dp 2s ease infinite;
}
.ap-sys-dot.green { color:#c8ff00; text-shadow:0 0 8px rgba(200,255,0,0.7); animation: dp-fast .6s ease infinite; }
@keyframes dp      { 0%,100%{opacity:1}  50%{opacity:0.3} }
@keyframes dp-fast { 0%,100%{opacity:1}  50%{opacity:0.1} }

/* ── Distance section ───────────────────────────────────────────────────── */
.ap-dist-section { position:relative; text-align:center; margin-bottom:8px; }
.ap-dist-label {
  font-family:'Barlow Condensed',sans-serif;
  font-size:7px; font-weight:700; letter-spacing:2px;
  color:rgba(200,255,0,0.32); text-transform:uppercase; margin-bottom:4px;
}
.ap-dist-val {
  display:flex; align-items:baseline; justify-content:center; gap:2px;
  font-family:'Barlow Condensed',sans-serif; font-weight:900; line-height:1;
  transition:color 0.35s;
}
.ap-dist-num { font-size:3.8rem; letter-spacing:-0.03em; }
.ap-dist-unit { font-size:1.6rem; opacity:0.7; }
.ap-at-line {
  font-size:2rem; letter-spacing:0.05em;
  animation: at-flash .7s ease infinite;
}
@keyframes at-flash { 0%,100%{opacity:1} 50%{opacity:0.45} }
.ap-speed {
  font-family:'Barlow Condensed',sans-serif;
  font-size:.8rem; font-weight:700; letter-spacing:1px;
  color:rgba(148,163,184,0.7); margin-top:2px;
}

/* ── ASCII bar ──────────────────────────────────────────────────────────── */
.ap-bar-section { margin-bottom:8px; }
.ap-bar-row {
  display:flex; align-items:center; justify-content:center; gap:2px;
  font-family:'Courier New',monospace;
}
.ap-bar-bracket { font-size:14px; color:rgba(200,255,0,0.4); line-height:1; }
.ap-bar-fill { font-size:11px; letter-spacing:-0.5px; line-height:1; transition:color .35s; }
.ap-bar-pct {
  font-family:'Barlow Condensed',sans-serif; font-size:9px; font-weight:700;
  color:rgba(200,255,0,0.4); margin-left:4px;
}

/* ── Status ─────────────────────────────────────────────────────────────── */
.ap-status {
  font-family:'Barlow Condensed',sans-serif;
  font-size:.8rem; font-weight:700; letter-spacing:.5px; text-transform:uppercase;
  color:rgba(148,163,184,0.7); text-align:center; margin-bottom:10px;
}
.ap-status-armed { color:#c8ff00; text-shadow:0 0 10px rgba(200,255,0,0.5); }
.ap-blink { animation: st-blink .85s ease infinite; }
@keyframes st-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* ── Actions ────────────────────────────────────────────────────────────── */
.ap-actions { display:flex; flex-direction:column; gap:6px; }

.ap-armed-msg {
  display:flex; align-items:center; justify-content:center; gap:6px;
  background:rgba(200,255,0,0.06); border:1px solid rgba(200,255,0,0.25);
  border-radius:6px; padding:8px 12px;
  font-family:'Barlow Condensed',sans-serif;
  font-size:.78rem; font-weight:700; letter-spacing:.3px;
  color:rgba(200,255,0,0.8);
}
.ap-arm-icon {
  font-size:1rem; text-shadow:0 0 10px rgba(200,255,0,0.7);
  animation: arm-icon .6s ease infinite;
}
@keyframes arm-icon { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.9)} }

.ap-row-btns { display:flex; gap:6px; }

.ap-btn {
  font-family:'Barlow Condensed',sans-serif;
  font-size:.78rem; font-weight:800; letter-spacing:.8px; text-transform:uppercase;
  padding:8px 14px; border-radius:6px; cursor:pointer; border:none;
  transition:opacity .15s,transform .1s;
}
.ap-btn:active { transform:scale(0.94); }

.ap-btn-arm {
  width:100%; background:#c8ff00; color:#000;
  font-size:.95rem; padding:10px;
  box-shadow:0 0 16px rgba(200,255,0,0.35);
}
.ap-btn-ble {
  flex:1; background:rgba(255,255,255,0.04);
  border:1px solid rgba(255,255,255,0.1) !important;
  color:rgba(255,255,255,0.55);
}
.ap-btn-abort {
  flex:1; background:transparent;
  border:1px solid rgba(239,68,68,0.28) !important;
  color:rgba(239,68,68,0.65);
  font-family:'Courier New',monospace; font-size:.75rem;
}
.ap-ble-ok {
  flex:1; display:flex; align-items:center; justify-content:center;
  font-family:'Barlow Condensed',sans-serif; font-size:.75rem; font-weight:700;
  color:rgba(34,197,94,0.8); background:rgba(34,197,94,0.07);
  border:1px solid rgba(34,197,94,0.25); border-radius:6px; padding:6px;
}
.ap-ble-dot { color:#22c55e; text-shadow:0 0 6px rgba(34,197,94,0.7); }
</style>
