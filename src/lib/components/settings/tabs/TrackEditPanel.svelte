<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { db } from '$lib/services/database';
  import { app } from '$lib/stores/app.svelte';
  import { FEAT_ICONS, FEAT_NAMES, CAT_COLORS, CAT_EMOJIS } from '$lib/types';
  import FeatPosPickerModal from '$lib/components/features/FeatPosPickerModal.svelte';
  import type { FeatureType, TrackCat, TrackCondition, TrackFeature, RunRecord } from '$lib/types';

  interface Props {
    trackId: string;
    onback:  () => void;
  }
  let { trackId, onback }: Props = $props();

  // ── Reaktive Ableitungen ──────────────────────────────────────────────────
  const track     = $derived(tracksStore.getTrack(trackId));
  const rating    = $derived(tracksStore.getRating(trackId));
  const features  = $derived(tracksStore.getFeatures(trackId));
  const edits     = $derived(tracksStore.getEdits(trackId));
  const condition = $derived(tracksStore.getCondition(trackId));

  // ── Lokale Draft-States (Name & Beschreibung explizit speichern) ──────────
  let nameEdit    = $state('');
  let descEdit    = $state('');
  let nameDirty   = $state(false);
  let descDirty   = $state(false);
  let saving      = $state(false);
  let flashMsg    = $state('');
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Rennzeiten ────────────────────────────────────────────────────────────
  let runs = $state<RunRecord[]>([]);
  let runsLoaded = $state(false);

  // ── Feature Picker ────────────────────────────────────────────────────────
  let showFeatPicker = $state(false);
  let editingFeat    = $state<TrackFeature | null>(null);

  // ── Draft init ────────────────────────────────────────────────────────────
  $effect(() => {
    if (track) {
      if (!nameDirty) nameEdit = track.name;
      if (!descDirty) descEdit = tracksStore.getDescription(trackId);
    }
  });

  // ── Runs laden ────────────────────────────────────────────────────────────
  $effect(() => {
    runsLoaded = false;
    db.runs.where('trackId').equals(trackId).sortBy('totalMs')
      .then(r => { runs = r; runsLoaded = true; });
  });

  // ── Konstanten ────────────────────────────────────────────────────────────
  const CATS: TrackCat[] = ['beginner', 'mittel', 'expert', 'custom'];
  const CAT_LABELS: Record<string, string> = {
    beginner: 'Beginner', mittel: 'Mittel', expert: 'Expert',
    'optional-logistik': 'Logistik', custom: 'Custom',
  };

  const WEATHER_CONDS: Array<{ val: TrackCondition; label: string; emoji: string }> = [
    { val: 'dry',     label: 'Trocken',   emoji: '🌞' },
    { val: 'muddy',   label: 'Schlammig', emoji: '💧' },
    { val: 'icy',     label: 'Eisig',     emoji: '🧊' },
    { val: 'unknown', label: 'Unbekannt', emoji: '❓' },
  ];

  const SURFACE_CONDS: Array<{ val: TrackCondition; label: string; emoji: string }> = [
    { val: 'pristine', label: 'Neuwertig',    emoji: '⭐' },
    { val: 'good',     label: 'Gut erhalten', emoji: '✅' },
    { val: 'worn',     label: 'Abgenutzt',    emoji: '🔧' },
    { val: 'rough',    label: 'Abgerockt',    emoji: '💀' },
  ];

  const DIFF_LABELS: Record<number, { label: string; color: string }> = {
    1: { label: 'Beginner', color: '#22c55e' },
    2: { label: 'Mittel',   color: '#f59e0b' },
    3: { label: 'Expert',   color: '#ef4444' },
  };

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────
  function flash(msg: string) {
    flashMsg = msg;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashMsg = ''; }, 2200);
  }

  function formatMs(ms: number): string {
    const m  = Math.floor(ms / 60000);
    const s  = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  function formatRunDate(dateStr: string): string {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  }

  function formatEditDate(ts: number): string {
    return new Date(ts).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Aktionen ──────────────────────────────────────────────────────────────
  async function saveName() {
    const trimmed = nameEdit.trim();
    if (!trimmed || !track) return;
    if (trimmed !== track.name) {
      saving = true;
      await tracksStore.renameTrack(trackId, trimmed);
      saving = false;
      flash('✓ Name gespeichert');
    }
    nameDirty = false;
  }

  async function saveDesc() {
    saving = true;
    await tracksStore.setDescription(trackId, descEdit);
    saving = false;
    descDirty = false;
    flash('✓ Beschreibung gespeichert');
  }

  async function saveAll() {
    saving = true;
    if (nameDirty) await saveName();
    if (descDirty) await saveDesc();
    saving = false;
    flash('✓ Alles gespeichert');
  }

  async function setRatingSave(stars: number) {
    await tracksStore.setRating(trackId, stars);
    flash(`✓ Bewertung: ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`);
  }

  async function setCondSave(val: TrackCondition) {
    await tracksStore.setCondition(trackId, val);
    flash('✓ Zustand gespeichert');
  }

  async function handleFeatSave(feat: TrackFeature) {
    const wasEditing = editingFeat;
    showFeatPicker = false;
    editingFeat = null;
    if (wasEditing?.id) {
      await tracksStore.updateFeature(trackId, wasEditing.id, feat);
      app.toast('Schlüsselstelle aktualisiert', 'success');
    } else {
      await tracksStore.addFeature(trackId, feat);
      if (track) tracksStore.renderFeatureMarkersOnMap(track);
      app.toast('Schlüsselstelle hinzugefügt', 'success');
    }
  }

  async function handleBack() {
    // Auto-save any unsaved text changes — no confirm dialog needed
    if (nameDirty || descDirty) {
      saving = true;
      if (nameDirty) await saveName();
      if (descDirty) await saveDesc();
      saving = false;
    }
    onback();
  }
</script>

{#if track}
<div class="tep">

  <!-- ── Sticky Header ────────────────────────────────────────────────── -->
  <div class="tep-header">
    <button class="tep-back-btn" onclick={handleBack} title="Zurück zur Streckenübersicht">
      ← Zurück
    </button>
    <span class="tep-title font-head" title={track.name}>{track.name}</span>
    {#if flashMsg}
      <span class="tep-flash">{flashMsg}</span>
    {:else if nameDirty || descDirty}
      <span class="tep-unsaved">● ungespeichert</span>
    {/if}
  </div>

  <!-- ── Scroll-Body ───────────────────────────────────────────────────── -->
  <div class="tep-body">

    <!-- ── Name ── -->
    <div class="tep-section">
      <div class="tep-label">Streckenname</div>
      <div class="tep-input-row">
        <input
          class="input tep-input"
          bind:value={nameEdit}
          oninput={() => nameDirty = nameEdit.trim() !== track!.name}
          onkeydown={(e) => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); saveName(); }
            if (e.key === 'Escape') { nameEdit = track!.name; nameDirty = false; }
          }}
          placeholder="Streckenname…"
        />
        {#if nameDirty}
          <button class="btn btn-primary btn-sm tep-save-btn" onclick={saveName} disabled={saving}>
            Speichern
          </button>
        {/if}
      </div>
    </div>

    <!-- ── Kategorie ── -->
    <div class="tep-section">
      <div class="tep-label">Kategorie</div>
      <div class="tep-chips">
        {#each CATS as cat}
          <button
            class="chip {track.cat === cat ? 'active' : ''}"
            style={track.cat === cat
              ? `background:${CAT_COLORS[cat]};color:#000;border-color:${CAT_COLORS[cat]}`
              : ''}
            onclick={async () => { await tracksStore.setCat(trackId, cat); flash('✓ Kategorie gespeichert'); }}
          >{CAT_EMOJIS[cat]} {CAT_LABELS[cat]}</button>
        {/each}
      </div>
    </div>

    <!-- ── Bewertung ── -->
    <div class="tep-section">
      <div class="tep-label">Bewertung</div>
      <div class="stars">
        {#each [1,2,3,4,5] as s}
          <button
            class="star {s <= rating ? 'filled' : ''}"
            onclick={() => setRatingSave(s)}
            title="{s} Stern{s !== 1 ? 'e' : ''}"
          >★</button>
        {/each}
        {#if rating > 0}
          <button class="star-clear" onclick={() => setRatingSave(0)} title="Bewertung löschen">✕</button>
        {/if}
      </div>
    </div>

    <!-- ── Beschreibung ── -->
    <div class="tep-section">
      <div class="tep-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Beschreibung</span>
        <span style="font-size:0.7rem;color:var(--td)">{descEdit.length}/400</span>
      </div>
      <textarea
        class="input tep-desc"
        maxlength={400}
        bind:value={descEdit}
        oninput={() => descDirty = descEdit !== tracksStore.getDescription(trackId)}
        placeholder="Streckeninfos, Besonderheiten, Empfehlungen…"
        rows={3}
      ></textarea>
      {#if descDirty}
        <button class="btn btn-primary btn-sm" style="margin-top:0.35rem;width:100%" onclick={saveDesc} disabled={saving}>
          Beschreibung speichern
        </button>
      {/if}
    </div>

    <!-- ── Streckenzustand ── -->
    <div class="tep-section">
      <div class="tep-label">Streckenzustand</div>
      <div class="tep-cond-group">
        <div class="tep-cond-title">Wetter</div>
        <div class="tep-chips">
          {#each WEATHER_CONDS as c}
            <button
              class="chip {condition === c.val ? 'active' : ''}"
              onclick={() => setCondSave(c.val)}
            >{c.emoji} {c.label}</button>
          {/each}
        </div>
      </div>
      <div class="tep-cond-group" style="margin-top:0.5rem">
        <div class="tep-cond-title">Pflegezustand</div>
        <div class="tep-chips">
          {#each SURFACE_CONDS as c}
            <button
              class="chip {condition === c.val ? 'active' : ''}"
              onclick={() => setCondSave(c.val)}
            >{c.emoji} {c.label}</button>
          {/each}
        </div>
      </div>
    </div>

    <!-- ── Schlüsselstellen ── -->
    <div class="tep-section">
      <div class="tep-section-header">
        <div class="tep-label" style="margin-bottom:0">
          Schlüsselstellen
          <span class="tep-count">{features.length}</span>
        </div>
        <button
          class="btn btn-secondary btn-sm"
          onclick={() => { editingFeat = null; showFeatPicker = true; }}
        >+ Hinzufügen</button>
      </div>

      {#if features.length === 0}
        <p class="text-sm text-dim tep-empty">Noch keine Schlüsselstellen markiert.</p>
      {:else}
        {#each features as feat}
          <div class="tep-feat-item">
            <span class="tep-feat-icon">{FEAT_ICONS[feat.type as FeatureType] ?? '📍'}</span>
            <div class="tep-feat-info">
              <span class="tep-feat-name">{feat.name || FEAT_NAMES[feat.type as FeatureType]}</span>
              {#if DIFF_LABELS[feat.diff]}
                <span class="diff-badge" style="background:{DIFF_LABELS[feat.diff].color}">
                  {DIFF_LABELS[feat.diff].label}
                </span>
              {/if}
            </div>
            <button
              class="btn-icon"
              onclick={() => { editingFeat = feat; showFeatPicker = true; }}
              title="Bearbeiten"
            >✏️</button>
            <button
              class="btn-icon tep-del"
              onclick={() => { if (confirm('Schlüsselstelle löschen?')) tracksStore.removeFeature(trackId, feat.id!); }}
              title="Löschen"
            >🗑</button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- ── Rennzeiten ── -->
    <div class="tep-section">
      <div class="tep-label">
        Rennzeiten
        <span class="tep-count">{runs.length}</span>
      </div>
      {#if !runsLoaded}
        <p class="text-sm text-dim tep-empty">Lädt…</p>
      {:else if runs.length === 0}
        <p class="text-sm text-dim tep-empty">Noch keine Rennzeiten auf dieser Strecke.</p>
      {:else}
        <div class="tep-runs">
          {#each runs as run, i}
            <div class="tep-run-item {i === 0 ? 'best' : ''}">
              <div class="tep-run-left">
                {#if i === 0}<span class="best-badge">BEST</span>{/if}
                <span class="tep-run-time">{formatMs(run.totalMs)}</span>
              </div>
              <div class="tep-run-meta">
                <span class="tep-run-date">{formatRunDate(run.date)}</span>
                {#if run.riderName}
                  <span class="tep-run-rider">{run.riderName}</span>
                {/if}
                {#if run.muniName}
                  <span class="tep-run-muni">{run.muniName}{run.wheelSize ? ` · ${run.wheelSize}"` : ''}</span>
                {/if}
                {#if run.fallEvents?.length > 0}
                  <span class="tep-run-falls" title="Sturzereignisse">
                    💥 {run.fallEvents.length}×
                  </span>
                {/if}
              </div>
              {#if run.splits?.length > 0}
                <div class="tep-run-splits">
                  {#each run.splits as sp, si}
                    <span class="split-chip">S{si + 1}: {formatMs(sp)}</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- ── Streckeninfos ── -->
    <div class="tep-section">
      <div class="tep-label">Streckeninfos</div>
      <div class="tep-stats">
        <div class="tep-stat">
          <span class="tep-stat-val">{track.stats.distKm.toFixed(2)} km</span>
          <span class="tep-stat-lbl">Distanz</span>
        </div>
        <div class="tep-stat">
          <span class="tep-stat-val">↑ {track.stats.elevGain.toFixed(0)} m</span>
          <span class="tep-stat-lbl">Aufstieg</span>
        </div>
        <div class="tep-stat">
          <span class="tep-stat-val">↓ {track.stats.elevLoss.toFixed(0)} m</span>
          <span class="tep-stat-lbl">Abstieg</span>
        </div>
        <div class="tep-stat">
          <span class="tep-stat-val">{track.stats.maxElev.toFixed(0)} m</span>
          <span class="tep-stat-lbl">Max. Höhe</span>
        </div>
      </div>
    </div>

    <!-- ── Änderungshistorie ── -->
    {#if edits.length > 0}
    <div class="tep-section">
      <div class="tep-label">Änderungshistorie</div>
      {#each edits.slice(0, 15) as edit}
        <div class="tep-hist-item">
          <span class="tep-hist-field">{edit.name}</span>
          <span class="tep-hist-arrow">→</span>
          <span class="tep-hist-val">{edit.newVal}</span>
          <span class="tep-hist-date">{formatEditDate(edit.date)}</span>
        </div>
      {/each}
    </div>
    {/if}

    <!-- ── Immer sichtbarer Speichern & Zurück-Button ── -->
    <div class="tep-save-footer">
      <button class="btn btn-primary tep-save-all" onclick={handleBack} disabled={saving}>
        {#if saving}
          ⏳ Speichert…
        {:else if nameDirty || descDirty}
          💾 Speichern & Zurück
        {:else}
          ← Zurück zur Streckenliste
        {/if}
      </button>
    </div>

  </div><!-- /tep-body -->
</div><!-- /tep -->
{/if}

<!-- Feature Picker Modal (über dem Panel) -->
{#if showFeatPicker}
  <FeatPosPickerModal
    trackId={trackId}
    editFeature={editingFeat}
    onclose={() => { showFeatPicker = false; editingFeat = null; }}
    onsave={handleFeatSave}
    onsaveAll={async (feats) => {
      for (const f of feats) await tracksStore.addFeature(trackId, f);
      if (track) tracksStore.renderFeatureMarkersOnMap(track);
      showFeatPicker = false;
      editingFeat = null;
      app.toast(`${feats.length} Schlüsselstelle${feats.length !== 1 ? 'n' : ''} gespeichert`, 'success');
    }}
  />
{/if}

<style>
  /* ── Layout ──────────────────────────────────────────────────────────── */
  .tep {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Header ─────────────────────────────────────────────────────────── */
  .tep-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--bd2);
    flex-shrink: 0;
    background: var(--s1);
    position: sticky;
    top: 0;
    z-index: 10;
    min-height: 2.4rem;
  }

  .tep-back-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: var(--s2);
    border: 1px solid var(--bd);
    border-radius: var(--r);
    color: var(--tx);
    font-size: 0.8rem;
    font-weight: 700;
    padding: 0.25rem 0.55rem;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .tep-back-btn:hover { background: var(--s3); }

  .tep-title {
    flex: 1;
    font-size: 0.88rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--tx);
  }

  .tep-flash {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ac);
    white-space: nowrap;
    flex-shrink: 0;
    animation: flashIn 0.2s ease;
  }

  .tep-unsaved {
    font-size: 0.68rem;
    color: #f59e0b;
    white-space: nowrap;
    flex-shrink: 0;
  }

  @keyframes flashIn {
    from { opacity: 0; transform: scale(0.9); }
    to   { opacity: 1; transform: scale(1); }
  }

  /* ── Scroll body ─────────────────────────────────────────────────────── */
  .tep-body {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 1rem;
  }

  /* ── Sections ────────────────────────────────────────────────────────── */
  .tep-section {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--bd);
  }

  .tep-label {
    font-family: var(--fh);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--td);
    margin-bottom: 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .tep-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--s3);
    border-radius: 1rem;
    font-size: 0.6rem;
    padding: 0 5px;
    min-width: 16px;
    height: 16px;
    color: var(--td);
  }

  .tep-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }

  .tep-empty {
    padding: 0.3rem 0;
    font-style: italic;
  }

  /* ── Name input row ──────────────────────────────────────────────────── */
  .tep-input-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .tep-input { flex: 1; }
  .tep-save-btn { flex-shrink: 0; }

  /* ── Chips ───────────────────────────────────────────────────────────── */
  .tep-chips {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  /* ── Stars ───────────────────────────────────────────────────────────── */
  .stars {
    display: flex;
    gap: 0.1rem;
    align-items: center;
  }

  .star {
    font-size: 1.5rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--bd2);
    padding: 0 0.05rem;
    transition: color 0.1s, transform 0.1s;
    line-height: 1;
  }
  .star:hover { transform: scale(1.2); }
  .star.filled { color: #f59e0b; }

  .star-clear {
    font-size: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--td);
    padding: 0 0.2rem;
    margin-left: 0.2rem;
  }
  .star-clear:hover { color: #ef4444; }

  /* ── Description ─────────────────────────────────────────────────────── */
  .tep-desc {
    resize: vertical;
    min-height: 3.5rem;
    font-size: 0.85rem;
    line-height: 1.45;
    width: 100%;
  }

  /* ── Condition groups ────────────────────────────────────────────────── */
  .tep-cond-group {}
  .tep-cond-title {
    font-size: 0.65rem;
    color: var(--td);
    margin-bottom: 0.25rem;
    font-style: italic;
  }

  /* ── Features ────────────────────────────────────────────────────────── */
  .tep-feat-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--bd);
  }
  .tep-feat-item:last-child { border-bottom: none; }
  .tep-feat-icon { font-size: 1.05rem; flex-shrink: 0; }
  .tep-feat-info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .tep-feat-name { font-size: 0.82rem; font-weight: 500; }
  .diff-badge {
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    color: #000;
    font-weight: 700;
    flex-shrink: 0;
  }
  .tep-del:hover { color: #ef4444; }

  /* ── Runs ────────────────────────────────────────────────────────────── */
  .tep-runs {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .tep-run-item {
    background: var(--s2);
    border: 1px solid var(--bd);
    border-radius: var(--r);
    padding: 0.4rem 0.6rem;
  }

  .tep-run-item.best {
    border-color: var(--ac);
    background: color-mix(in srgb, var(--ac) 8%, var(--s2));
  }

  .tep-run-left {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.15rem;
  }

  .best-badge {
    font-size: 0.6rem;
    font-weight: 900;
    font-family: var(--fh);
    background: var(--ac);
    color: #000;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.05em;
  }

  .tep-run-time {
    font-family: var(--fh);
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--tx);
  }

  .tep-run-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--td);
  }

  .tep-run-date { }
  .tep-run-rider { color: var(--tx); font-weight: 500; }
  .tep-run-muni  { }
  .tep-run-falls { color: #ef4444; font-weight: 600; }

  .tep-run-splits {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }

  .split-chip {
    font-size: 0.65rem;
    background: var(--s3);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--td);
    font-family: var(--fh);
  }

  /* ── Stats ───────────────────────────────────────────────────────────── */
  .tep-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1rem;
  }
  .tep-stat { display: flex; flex-direction: column; }
  .tep-stat-val { font-size: 0.9rem; font-weight: 700; color: var(--tx); }
  .tep-stat-lbl { font-size: 0.65rem; color: var(--td); }

  /* ── History ─────────────────────────────────────────────────────────── */
  .tep-hist-item {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--bd);
    font-size: 0.75rem;
  }
  .tep-hist-item:last-child { border-bottom: none; }
  .tep-hist-field {
    color: var(--td);
    flex-shrink: 0;
    width: 5.5rem;
    font-style: italic;
  }
  .tep-hist-arrow { color: var(--td); flex-shrink: 0; }
  .tep-hist-val   { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tep-hist-date  { color: var(--td); font-size: 0.62rem; flex-shrink: 0; }

  /* ── Save footer ─────────────────────────────────────────────────────── */
  .tep-save-footer {
    padding: 0.75rem;
    position: sticky;
    bottom: 0;
    background: var(--s1);
    border-top: 1px solid var(--bd2);
  }

  .tep-save-all {
    width: 100%;
    font-size: 0.9rem;
    font-weight: 700;
    padding: 0.65rem;
  }
</style>
