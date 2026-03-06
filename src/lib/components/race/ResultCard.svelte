<script lang="ts">
  import { raceEngine } from '$lib/stores/race.svelte';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { formatDuration, formatSplitMs } from '$lib/services/geo';
  import { encodeObjectToChunks } from '$lib/services/qr-engine';
  import { db } from '$lib/services/database';
  import QRDisplay from '../qr/QRDisplay.svelte';
  import type { RunRecord } from '$lib/types';

  let run         = $state<RunRecord | null>(null);
  let allRuns     = $state<RunRecord[]>([]);
  let qrChunks    = $state<string[]>([]);
  let showQr      = $state(false);
  let showHistory = $state(false);

  $effect(() => {
    if (raceEngine.state === 'finished') {
      raceEngine.getLastRun().then(r => {
        run = r;
        if (r) qrChunks = encodeObjectToChunks(r, 'run');
      });
      if (raceEngine.trackId) {
        raceEngine.getRunsForTrack(raceEngine.trackId).then(runs => {
          allRuns = runs.sort((a, b) => a.totalMs - b.totalMs);
        });
      }
    }
  });

  const bestMs    = $derived(allRuns.length > 0 ? allRuns[0].totalMs : 0);
  const avgMs     = $derived(
    allRuns.length > 0
      ? Math.round(allRuns.reduce((s, r) => s + r.totalMs, 0) / allRuns.length)
      : 0
  );
  const isNewPb   = $derived(run !== null && allRuns.length > 0 && run.totalMs <= bestMs);
  const trackName = $derived(
    raceEngine.trackId ? (tracksStore.getTrack(raceEngine.trackId)?.name ?? '') : ''
  );

  const maxSplit = $derived(run ? Math.max(...run.splits, 1) : 1);

  function sectorBar(splitMs: number, maxMs: number): string {
    if (maxMs <= 0) return '████████';
    const filled = Math.round((splitMs / maxMs) * 8);
    return '█'.repeat(Math.min(8, filled)) + '░'.repeat(Math.max(0, 8 - filled));
  }

  async function shareResult() {
    if (!run) return;
    const lines = [
      'GMTW Race Result',
      `Track: ${trackName}`,
      `Zeit: ${formatDuration(run.totalMs)}`,
      run.splits.length > 0
        ? `Sektoren: ${run.splits.map((s: number, i: number) => `S${i+1} ${formatSplitMs(s)}`).join(', ')}`
        : '',
      run.fallEvents.length > 0 ? `Stürze: ${run.fallEvents.length}` : '',
      run.signature ? `Sig: ${run.signature.slice(0, 16)}…` : '',
    ].filter(Boolean).join('\n');
    if (navigator.share) {
      try { await navigator.share({ title: 'GMTW Race Result', text: lines }); return; } catch {}
    }
    await navigator.clipboard.writeText(lines);
    app.toast('Ergebnis kopiert', 'success');
  }

  async function deleteRun() {
    if (!run) return;
    if (!confirm('Run löschen?')) return;
    await db.runs.delete(run.id);
    raceEngine.reset();
  }
</script>

{#if raceEngine.state === 'finished'}
<div class="rc-overlay" role="dialog" aria-label="Rennergebnis" aria-modal="true">
  <div class="rc-bg-scanlines" aria-hidden="true"></div>

  {#if run}
  <div class="rc-card">
    <div class="rc-scanlines" aria-hidden="true"></div>

    <!-- ── Header / Mission Debrief ── -->
    <div class="rc-header">
      <div class="rc-sys-row">
        <span class="rc-sys-tag">GMTW&nbsp;RACE&nbsp;LOG</span>
        <span class="rc-sys-date">{run.date}</span>
        <span class="rc-sys-sig" class:rc-sig-ok={!!run.signature}>
          {run.signature ? '🔒&nbsp;VERIFIZIERT' : '⚠&nbsp;UNSIGNIERT'}
        </span>
      </div>

      <div class="rc-track">{trackName || 'UNBEKANNTE&nbsp;STRECKE'}</div>

      {#if isNewPb}
        <div class="rc-pb-badge">⚡&nbsp;NEUE&nbsp;BESTZEIT&nbsp;⚡</div>
      {/if}

      <div class="rc-time" class:rc-time-pb={isNewPb}>
        {formatDuration(run.totalMs)}
      </div>

      {#if run.fallEvents.length > 0}
        <div class="rc-fall-sum">
          ⚠&nbsp;{run.fallEvents.length}&nbsp;EVENT{run.fallEvents.length > 1 ? 'S' : ''}
          &nbsp;·&nbsp;{run.fallEvents.filter(e => e.type === 'fall').length}&nbsp;STURZ
          &nbsp;·&nbsp;{run.fallEvents.filter(e => e.type === 'dismount').length}&nbsp;ABSTIEG
        </div>
      {:else}
        <div class="rc-clean-run">✓&nbsp;CLEAN&nbsp;RUN</div>
      {/if}
    </div>

    <div class="rc-div"></div>

    <!-- ── Sector analysis ── -->
    {#if run.splits.length > 0}
    <div class="rc-sec">
      <div class="rc-sec-ttl">SEKTOR-ANALYSE</div>
      {#each run.splits as split, i}
        {@const cumMs = run.splits.slice(0, i + 1).reduce((a: number, b: number) => a + b, 0)}
        <div class="rc-split-row">
          <span class="rc-sl-lbl">S{i+1}</span>
          <span class="rc-sl-bar" aria-hidden="true">{sectorBar(split, maxSplit)}</span>
          <span class="rc-sl-val">{formatSplitMs(split)}</span>
          <span class="rc-sl-cum">[{formatDuration(cumMs)}]</span>
        </div>
      {/each}
    </div>
    <div class="rc-div"></div>
    {/if}

    <!-- ── Event log ── -->
    {#if run.fallEvents.length > 0}
    <div class="rc-sec">
      <div class="rc-sec-ttl" style="color:#f59e0b">EREIGNIS-LOG</div>
      {#each run.fallEvents as ev}
        <div class="rc-ev-row" class:rc-ev-fall={ev.type === 'fall'}>
          <span class="rc-ev-t">{ev.type === 'fall' ? '⚠&nbsp;STURZ' : '⬇&nbsp;ABSTIEG'}</span>
          <span class="rc-ev-ts">@ {(ev.ts/1000).toFixed(1)}s</span>
          <span class="rc-ev-pos">{ev.lat.toFixed(5)}, {ev.lng.toFixed(5)}</span>
        </div>
      {/each}
    </div>
    <div class="rc-div"></div>
    {/if}

    <!-- ── Comparison stats ── -->
    {#if allRuns.length > 1}
    <div class="rc-sec">
      <div class="rc-sec-ttl">STATISTIK&nbsp;({allRuns.length}&nbsp;RUNS)</div>
      <div class="rc-stat-row">
        <span class="rc-st-lbl">BESTZEIT</span>
        <span class="rc-st-val" style="color:#c8ff00">{formatDuration(bestMs)}</span>
      </div>
      <div class="rc-stat-row">
        <span class="rc-st-lbl">DURCHSCHNITT</span>
        <span class="rc-st-val">{formatDuration(avgMs)}</span>
      </div>
      {#if !isNewPb}
      <div class="rc-stat-row">
        <span class="rc-st-lbl">RÜCKSTAND</span>
        <span class="rc-st-val" style="color:#ef4444">+{formatDuration(run.totalMs - bestMs)}</span>
      </div>
      {/if}
    </div>
    <div class="rc-div"></div>
    {/if}

    <!-- ── Signature ── -->
    {#if run.signature}
    <div class="rc-sec">
      <div class="rc-sec-ttl">HMAC-SHA256&nbsp;SIGNATUR</div>
      <div class="rc-sig-block">
        <code class="rc-sig-code">{run.signature}</code>
        <div class="rc-sig-meta">
          {run.riderName || '—'}&nbsp;·&nbsp;{run.muniName || '—'}&nbsp;·&nbsp;{run.wheelSize}"&nbsp;·&nbsp;{run.seatClampColor || '—'}
        </div>
      </div>
    </div>
    <div class="rc-div"></div>
    {/if}

    <!-- ── QR export ── -->
    {#if showQr && qrChunks.length > 0}
    <div class="rc-sec">
      <div class="rc-sec-ttl">QR&nbsp;EXPORT</div>
      <QRDisplay chunks={qrChunks} />
    </div>
    <div class="rc-div"></div>
    {/if}

    <!-- ── History ── -->
    {#if showHistory && allRuns.length > 1}
    <div class="rc-sec">
      <div class="rc-sec-ttl">RUN&nbsp;HISTORY</div>
      {#each allRuns as r, i}
        <div class="rc-hist-row" class:rc-hist-cur={r.id === run.id}>
          <span class="rc-hi-rank">#{i+1}</span>
          <span class="rc-hi-time">{formatDuration(r.totalMs)}</span>
          <span class="rc-hi-date">{r.date}</span>
          {#if r.fallEvents.length > 0}<span class="rc-hi-ev">⚠{r.fallEvents.length}</span>{/if}
          {#if i === 0}<span class="rc-hi-pb">PB</span>{/if}
        </div>
      {/each}
    </div>
    <div class="rc-div"></div>
    {/if}

    <!-- ── Action bar ── -->
    <div class="rc-actions">
      <button class="rcbtn" onclick={() => showQr = !showQr}>
        QR&nbsp;{showQr ? '▲' : '▼'}
      </button>
      {#if allRuns.length > 1}
        <button class="rcbtn" onclick={() => showHistory = !showHistory}>
          LOG&nbsp;{showHistory ? '▲' : '▼'}
        </button>
      {/if}
      <button class="rcbtn" onclick={shareResult}>TEILEN</button>
      <button class="rcbtn rcbtn-danger" onclick={deleteRun}>DEL</button>
      <button class="rcbtn rcbtn-primary" onclick={() => raceEngine.reset()}>[FERTIG]</button>
    </div>
  </div>

  {:else}
  <div class="rc-loading">
    <div class="rc-spinner" aria-hidden="true"></div>
    <span class="rc-loading-txt">LADE&nbsp;DATEN…</span>
  </div>
  {/if}
</div>
{/if}

<style>
/* ── Overlay ────────────────────────────────────────────────────────────── */
.rc-overlay {
  position: fixed;
  inset: 0;
  z-index: 310;
  background: rgba(3, 7, 3, 0.97);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow-y: auto;
}

.rc-bg-scanlines {
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg, transparent 0px, transparent 3px,
    rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px
  );
  pointer-events: none;
  z-index: 311;
}

/* ── Card ───────────────────────────────────────────────────────────────── */
.rc-card {
  position: relative;
  z-index: 312;
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  overflow-x: hidden;

  background: rgba(5, 10, 5, 0.99);
  border: 1px solid rgba(200, 255, 0, 0.4);
  border-radius: 10px;

  box-shadow:
    0 0 0 1px rgba(200,255,0,0.08),
    0 0 40px rgba(200,255,0,0.18),
    0 20px 60px rgba(0,0,0,0.9);

  animation: rc-in 0.38s cubic-bezier(0.16,1,0.3,1) both;
}

@keyframes rc-in {
  from { opacity:0; transform:scale(0.94) translateY(20px); }
  to   { opacity:1; transform:scale(1) translateY(0); }
}

.rc-scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg, transparent 0px, transparent 3px,
    rgba(0,0,0,0.10) 3px, rgba(0,0,0,0.10) 4px
  );
  pointer-events: none;
  z-index: 0;
  border-radius: inherit;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.rc-header {
  position: relative; z-index: 1;
  padding: 14px 14px 10px;
  text-align: center;
}

.rc-sys-row {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 8px; padding-bottom: 6px;
  border-bottom: 1px solid rgba(200,255,0,0.09);
}

.rc-sys-tag {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px; font-weight: 800; letter-spacing: 2px;
  color: rgba(200,255,0,0.55); text-transform: uppercase;
}

.rc-sys-date {
  font-family: 'Courier New', monospace;
  font-size: 8px; color: rgba(200,255,0,0.3); margin-left: auto;
}

.rc-sys-sig {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 7px; font-weight: 800; letter-spacing: 0.8px;
  color: rgba(245,158,11,0.7); text-transform: uppercase;
}
.rc-sig-ok { color: #22c55e; }

.rc-track {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: .95rem; font-weight: 700; letter-spacing: 1px;
  color: rgba(200,255,0,0.55); text-transform: uppercase;
  margin-bottom: 6px;
}

.rc-pb-badge {
  display: inline-block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
  color: #000; background: #c8ff00; border-radius: 4px;
  padding: 3px 10px; margin-bottom: 6px;
  box-shadow: 0 0 16px rgba(200,255,0,0.5);
  animation: pb-pulse .7s ease infinite;
}
@keyframes pb-pulse {
  0%,100%{transform:scale(1);box-shadow:0 0 16px rgba(200,255,0,.5)}
  50%{transform:scale(1.04);box-shadow:0 0 28px rgba(200,255,0,.8)}
}

.rc-time {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 3.8rem; font-weight: 900; line-height: 1; letter-spacing: -.02em;
  color: #c8ff00; text-shadow: 0 0 16px rgba(200,255,0,0.5);
}
.rc-time-pb {
  text-shadow: 0 0 24px rgba(200,255,0,.8), 0 0 48px rgba(200,255,0,.3);
  animation: pb-glow 1.5s ease infinite;
}
@keyframes pb-glow {
  0%,100%{text-shadow:0 0 24px rgba(200,255,0,.8),0 0 48px rgba(200,255,0,.3)}
  50%{text-shadow:0 0 40px rgba(200,255,0,1),0 0 80px rgba(200,255,0,.5)}
}

.rc-fall-sum {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: .75rem; font-weight: 700; letter-spacing: .5px;
  color: #f59e0b; text-shadow: 0 0 8px rgba(245,158,11,.4);
  margin-top: 4px; text-transform: uppercase;
}
.rc-clean-run {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: .7rem; font-weight: 800; letter-spacing: 1.5px;
  color: #22c55e; text-shadow: 0 0 8px rgba(34,197,94,.4);
  margin-top: 4px; text-transform: uppercase;
}

/* ── Divider ────────────────────────────────────────────────────────────── */
.rc-div {
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(200,255,0,.15) 30%, rgba(200,255,0,.15) 70%, transparent);
}

/* ── Section ────────────────────────────────────────────────────────────── */
.rc-sec { position:relative; z-index:1; padding: 8px 14px; }
.rc-sec-ttl {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 7px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
  color: rgba(200,255,0,0.4); margin-bottom: 6px;
}

/* ── Splits ─────────────────────────────────────────────────────────────── */
.rc-split-row {
  display:flex; align-items:center; gap:6px; padding:3px 0;
  font-family:'Barlow Condensed',sans-serif;
  border-bottom:1px solid rgba(255,255,255,.03);
}
.rc-split-row:last-child { border-bottom:none; }
.rc-sl-lbl {
  font-size:.8rem; font-weight:800; letter-spacing:.5px;
  color:rgba(200,255,0,.5); min-width:20px;
}
.rc-sl-bar {
  font-family:'Courier New',monospace; font-size:10px;
  color:rgba(200,255,0,.38); letter-spacing:-.5px; flex-shrink:0;
}
.rc-sl-val { font-size:.95rem; font-weight:800; color:#c8ff00; text-shadow:0 0 6px rgba(200,255,0,.3); flex-shrink:0; }
.rc-sl-cum { font-family:'Courier New',monospace; font-size:.62rem; color:rgba(255,255,255,.22); margin-left:auto; }

/* ── Events ─────────────────────────────────────────────────────────────── */
.rc-ev-row {
  display:flex; align-items:center; gap:8px; padding:3px 0;
  font-family:'Barlow Condensed',sans-serif; font-size:.78rem; font-weight:700;
  color:#94a3b8; border-bottom:1px solid rgba(255,255,255,.03);
}
.rc-ev-row:last-child { border-bottom:none; }
.rc-ev-fall { color:#f59e0b; }
.rc-ev-t { min-width:90px; letter-spacing:.5px; text-transform:uppercase; }
.rc-ev-ts { color:rgba(200,255,0,.5); font-size:.7rem; min-width:55px; }
.rc-ev-pos { font-family:'Courier New',monospace; font-size:.58rem; color:rgba(255,255,255,.2); margin-left:auto; }

/* ── Stats ──────────────────────────────────────────────────────────────── */
.rc-stat-row {
  display:flex; justify-content:space-between; align-items:center; padding:3px 0;
  font-family:'Barlow Condensed',sans-serif; font-size:.85rem;
  border-bottom:1px solid rgba(255,255,255,.03);
}
.rc-stat-row:last-child{border-bottom:none;}
.rc-st-lbl { color:rgba(255,255,255,.38); font-size:.75rem; letter-spacing:.5px; }
.rc-st-val { font-weight:800; color:rgba(255,255,255,.85); }

/* ── Signature ──────────────────────────────────────────────────────────── */
.rc-sig-block {
  background:rgba(200,255,0,.03); border:1px solid rgba(200,255,0,.12);
  border-radius:5px; padding:6px 8px;
}
.rc-sig-code {
  display:block; font-family:'Courier New',monospace; font-size:.62rem;
  word-break:break-all; color:rgba(200,255,0,.55); margin-bottom:3px;
}
.rc-sig-meta { font-family:'Barlow Condensed',sans-serif; font-size:.7rem; color:rgba(255,255,255,.28); letter-spacing:.3px; }

/* ── History ────────────────────────────────────────────────────────────── */
.rc-hist-row {
  display:flex; align-items:center; gap:8px; padding:4px 0;
  font-family:'Barlow Condensed',sans-serif; font-size:.82rem;
  border-bottom:1px solid rgba(255,255,255,.04);
}
.rc-hist-row:last-child{border-bottom:none;}
.rc-hist-cur { background:rgba(200,255,0,.04); margin:0 -14px; padding:4px 14px; }
.rc-hi-rank { color:rgba(200,255,0,.4); font-weight:800; min-width:26px; }
.rc-hi-time { font-weight:800; color:#e2e8f0; flex:1; }
.rc-hi-date { color:rgba(255,255,255,.28); font-size:.7rem; }
.rc-hi-ev   { color:#f59e0b; font-size:.7rem; }
.rc-hi-pb   { font-size:7px; font-weight:800; letter-spacing:1px; background:#c8ff00; color:#000; border-radius:3px; padding:1px 4px; }

/* ── Actions ────────────────────────────────────────────────────────────── */
.rc-actions {
  position:relative; z-index:1;
  display:flex; gap:5px; padding:8px 14px 12px; flex-wrap:wrap;
  border-top:1px solid rgba(200,255,0,.07);
}
.rcbtn {
  font-family:'Barlow Condensed',sans-serif; font-size:10px; font-weight:800;
  letter-spacing:1px; text-transform:uppercase; padding:7px 10px; border-radius:5px;
  cursor:pointer; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
  color:rgba(255,255,255,.55); transition:background .12s,transform .1s; flex:1; min-width:50px;
}
.rcbtn:active{transform:scale(0.93)}
.rcbtn-primary {
  background:rgba(200,255,0,.11); border-color:rgba(200,255,0,.33); color:#c8ff00;
  font-family:'Courier New',monospace; font-size:9px; flex:2;
  text-shadow:0 0 8px rgba(200,255,0,.4);
}
.rcbtn-primary:active{background:rgba(200,255,0,.2)}
.rcbtn-danger { color:rgba(239,68,68,.7); border-color:rgba(239,68,68,.22); flex:none; padding:7px 8px; }
.rcbtn-danger:active{background:rgba(239,68,68,.1)}

/* ── Loading ────────────────────────────────────────────────────────────── */
.rc-loading { display:flex; flex-direction:column; align-items:center; gap:10px; padding:3rem; }
.rc-spinner {
  width:32px; height:32px;
  border:2px solid rgba(200,255,0,.15); border-top-color:rgba(200,255,0,.7);
  border-radius:50%; animation:rc-spin .7s linear infinite;
}
@keyframes rc-spin{to{transform:rotate(360deg)}}
.rc-loading-txt {
  font-family:'Barlow Condensed',sans-serif; font-size:.8rem; font-weight:800;
  letter-spacing:2px; color:rgba(200,255,0,.4); text-transform:uppercase;
  animation:rc-ltxt .8s ease infinite;
}
@keyframes rc-ltxt{0%,100%{opacity:1}50%{opacity:.3}}
</style>
