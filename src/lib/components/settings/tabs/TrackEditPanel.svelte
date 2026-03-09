<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { FEAT_ICONS, FEAT_NAMES, CAT_COLORS, CAT_EMOJIS } from '$lib/types';
  import FeatPosPickerModal from '$lib/components/features/FeatPosPickerModal.svelte';
  import type { FeatureType, TrackCat, TrackCondition, TrackFeature } from '$lib/types';

  interface Props {
    trackId: string;
    onback:  () => void;
  }
  let { trackId, onback }: Props = $props();

  const track     = $derived(tracksStore.getTrack(trackId));
  const rating    = $derived(tracksStore.getRating(trackId));
  const features  = $derived(tracksStore.getFeatures(trackId));
  const edits     = $derived(tracksStore.getEdits(trackId));
  const condition = $derived(tracksStore.getCondition(trackId));

  let descEdit       = $state('');
  let nameEdit       = $state('');
  let editingName    = $state(false);
  let showFeatPicker = $state(false);
  let editingFeat    = $state<TrackFeature | null>(null);

  $effect(() => {
    if (track) {
      nameEdit = track.name;
      descEdit = tracksStore.getDescription(trackId);
    }
  });

  const CATS: TrackCat[] = ['beginner', 'mittel', 'expert', 'custom'];
  const CAT_LABELS: Record<string, string> = {
    beginner:           'Beginner',
    mittel:             'Mittel',
    expert:             'Expert',
    'optional-logistik': 'Logistik',
    custom:             'Custom',
  };

  const CONDITIONS: Array<{ val: TrackCondition; label: string; emoji: string }> = [
    { val: 'dry',     label: 'Trocken',   emoji: '🌞' },
    { val: 'muddy',   label: 'Schlammig', emoji: '💧' },
    { val: 'icy',     label: 'Eisig',     emoji: '🧊' },
    { val: 'unknown', label: 'Unbekannt', emoji: '❓' },
  ];

  const DIFF_LABELS: Record<number, { label: string; color: string }> = {
    1: { label: 'Beginner', color: '#22c55e' },
    2: { label: 'Mittel',   color: '#f59e0b' },
    3: { label: 'Expert',   color: '#ef4444' },
  };

  function commitName() {
    editingName = false;
    const trimmed = nameEdit.trim();
    if (trimmed && track && trimmed !== track.name) {
      tracksStore.renameTrack(trackId, trimmed);
    }
  }

  function commitDesc() {
    tracksStore.setDescription(trackId, descEdit);
  }

  async function handleFeatSave(feat: TrackFeature) {
    const wasEditing = editingFeat;
    showFeatPicker = false;
    editingFeat    = null;
    if (wasEditing?.id) {
      await tracksStore.updateFeature(trackId, wasEditing.id, feat);
      app.toast('Feature aktualisiert', 'success');
    } else {
      await tracksStore.addFeature(trackId, feat);
      if (track) tracksStore.renderFeatureMarkersOnMap(track);
      app.toast('Feature hinzugefügt', 'success');
    }
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }
</script>

{#if track}
<div class="tep">
  <!-- ── Header ── -->
  <div class="tep-header">
    <button class="btn-icon tep-back" onclick={onback} title="Zurück">←</button>
    <span class="tep-title font-head" title={track.name}>{track.name}</span>
  </div>

  <div class="tep-body">

    <!-- ── Name ── -->
    <div class="tep-section">
      <div class="tep-sect-label">Streckenname</div>
      {#if editingName}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="input"
          autofocus
          bind:value={nameEdit}
          onblur={commitName}
          onkeydown={(e) => {
            if (e.key === 'Enter')  commitName();
            if (e.key === 'Escape') { editingName = false; nameEdit = track.name; }
          }}
        />
      {:else}
        <button class="tep-name-row" onclick={() => editingName = true}>
          <span class="tep-name-text">{track.name}</span>
          <span class="tep-edit-icon">✏️</span>
        </button>
      {/if}
    </div>

    <!-- ── Category ── -->
    <div class="tep-section">
      <div class="tep-sect-label">Kategorie</div>
      <div class="tep-chips">
        {#each CATS as cat}
          <button
            class="chip {track.cat === cat ? 'active' : ''}"
            style={track.cat === cat
              ? `background:${CAT_COLORS[cat]};color:#000;border-color:${CAT_COLORS[cat]}`
              : ''}
            onclick={() => tracksStore.setCat(trackId, cat)}
          >{CAT_EMOJIS[cat]} {CAT_LABELS[cat]}</button>
        {/each}
      </div>
    </div>

    <!-- ── Rating ── -->
    <div class="tep-section">
      <div class="tep-sect-label">Bewertung</div>
      <div class="stars">
        {#each [1,2,3,4,5] as s}
          <button
            class="star {s <= rating ? 'filled' : ''}"
            onclick={() => tracksStore.setRating(trackId, s)}
          >★</button>
        {/each}
      </div>
    </div>

    <!-- ── Description ── -->
    <div class="tep-section">
      <div class="tep-sect-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Beschreibung</span>
        <span style="font-size:0.7rem;color:var(--td)">{descEdit.length}/400</span>
      </div>
      <textarea
        class="input tep-desc"
        maxlength={400}
        bind:value={descEdit}
        placeholder="Streckeninfos, Besonderheiten, Empfehlungen…"
        onblur={commitDesc}
        rows={3}
      ></textarea>
    </div>

    <!-- ── Condition ── -->
    <div class="tep-section">
      <div class="tep-sect-label">Streckenzustand</div>
      <div class="tep-chips">
        {#each CONDITIONS as c}
          <button
            class="chip {condition === c.val ? 'active' : ''}"
            onclick={() => tracksStore.setCondition(trackId, c.val)}
          >{c.emoji} {c.label}</button>
        {/each}
      </div>
    </div>

    <!-- ── Features / Schlüsselstellen ── -->
    <div class="tep-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
        <div class="tep-sect-label" style="margin-bottom:0">
          Schlüsselstellen ({features.length})
        </div>
        <button
          class="btn btn-secondary btn-sm"
          onclick={() => { editingFeat = null; showFeatPicker = true; }}
        >+ Hinzufügen</button>
      </div>

      {#each features as feat}
        <div class="tep-feat-item">
          <span class="tep-feat-icon">{FEAT_ICONS[feat.type as FeatureType] ?? '📍'}</span>
          <div class="tep-feat-info">
            <span class="tep-feat-name">{feat.name || FEAT_NAMES[feat.type as FeatureType]}</span>
            {#if DIFF_LABELS[feat.diff]}
              <span class="tep-diff-badge" style="background:{DIFF_LABELS[feat.diff].color}">
                {DIFF_LABELS[feat.diff].label}
              </span>
            {/if}
          </div>
          <button
            class="btn-icon"
            style="font-size:0.8rem;flex-shrink:0"
            onclick={() => { editingFeat = feat; showFeatPicker = true; }}
            title="Bearbeiten"
          >✏️</button>
          <button
            class="btn-icon"
            style="font-size:0.8rem;color:#ef4444;flex-shrink:0"
            onclick={() => { if (confirm('Feature löschen?')) tracksStore.removeFeature(trackId, feat.id!); }}
            title="Löschen"
          >🗑</button>
        </div>
      {/each}

      {#if features.length === 0}
        <p class="text-sm text-dim" style="padding:0.4rem 0">
          Noch keine Schlüsselstellen markiert.
        </p>
      {/if}
    </div>

    <!-- ── Streckeninfos (read-only) ── -->
    <div class="tep-section">
      <div class="tep-sect-label">Streckeninfos</div>
      <div class="tep-stats-row">
        <div class="tep-stat">
          <span class="tep-stat-val">{track.stats.distKm.toFixed(1)} km</span>
          <span class="tep-stat-lbl">Distanz</span>
        </div>
        <div class="tep-stat">
          <span class="tep-stat-val">↑{track.stats.elevGain.toFixed(0)} m</span>
          <span class="tep-stat-lbl">Aufstieg</span>
        </div>
        <div class="tep-stat">
          <span class="tep-stat-val">↓{track.stats.elevLoss.toFixed(0)} m</span>
          <span class="tep-stat-lbl">Abstieg</span>
        </div>
        <div class="tep-stat">
          <span class="tep-stat-val">{track.stats.maxElev.toFixed(0)} m</span>
          <span class="tep-stat-lbl">Max. Höhe</span>
        </div>
      </div>
    </div>

    <!-- ── Änderungshistorie ── -->
    <div class="tep-section">
      <div class="tep-sect-label">Änderungshistorie</div>
      {#if edits.length === 0}
        <p class="text-sm text-dim" style="padding:0.3rem 0">Noch keine Änderungen.</p>
      {:else}
        {#each edits.slice(0, 10) as edit}
          <div class="tep-history-item">
            <span class="tep-hist-field">{edit.name}</span>
            <span class="tep-hist-val truncate">{edit.newVal}</span>
            <span class="tep-hist-date">{formatDate(edit.date)}</span>
          </div>
        {/each}
      {/if}
    </div>

  </div><!-- /tep-body -->
</div><!-- /tep -->
{/if}

{#if showFeatPicker}
  <FeatPosPickerModal
    trackId={trackId}
    editFeature={editingFeat}
    onclose={() => { showFeatPicker = false; editingFeat = null; }}
    onsave={handleFeatSave}
    onsaveAll={async (feats) => {
      for (const f of feats) {
        await tracksStore.addFeature(trackId, f);
      }
      if (track) tracksStore.renderFeatureMarkersOnMap(track);
      showFeatPicker = false;
      editingFeat    = null;
      app.toast(`${feats.length} Schlüsselstelle${feats.length !== 1 ? 'n' : ''} gespeichert`, 'success');
    }}
  />
{/if}

<style>
  .tep {
    display: flex; flex-direction: column;
    height: 100%; overflow: hidden;
  }

  .tep-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--bd2);
    flex-shrink: 0;
  }
  .tep-back {
    font-size: 1.1rem; font-weight: 700;
    width: 2rem; height: 2rem;
    flex-shrink: 0;
  }
  .tep-title {
    flex: 1; font-size: 0.95rem; font-weight: 700;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .tep-body {
    flex: 1; overflow-y: auto;
  }

  .tep-section {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--bd);
  }
  .tep-sect-label {
    font-family: var(--fh); font-size: 0.68rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--td); margin-bottom: 0.4rem;
  }

  /* Name row */
  .tep-name-row {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%; text-align: left;
    cursor: pointer; padding: 0.3rem 0;
    background: none; border: none; color: inherit;
  }
  .tep-name-row:hover .tep-edit-icon { opacity: 1; }
  .tep-name-text { flex: 1; font-size: 0.95rem; }
  .tep-edit-icon { opacity: 0.35; transition: opacity 0.15s; font-size: 0.85rem; }

  /* Chips row */
  .tep-chips { display: flex; gap: 0.35rem; flex-wrap: wrap; }

  /* Description textarea */
  .tep-desc { resize: vertical; min-height: 4rem; font-size: 0.85rem; line-height: 1.4; }

  /* Feature items */
  .tep-feat-item {
    display: flex; align-items: center; gap: 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--bd);
  }
  .tep-feat-item:last-child { border-bottom: none; }
  .tep-feat-icon { font-size: 1.1rem; flex-shrink: 0; }
  .tep-feat-info {
    flex: 1; display: flex; align-items: center; gap: 0.35rem;
    flex-wrap: wrap; min-width: 0;
  }
  .tep-feat-name { font-size: 0.85rem; font-weight: 500; }
  .tep-diff-badge {
    font-size: 0.62rem; padding: 1px 5px; border-radius: 3px;
    color: #000; font-weight: 700; flex-shrink: 0;
  }

  /* Stats row */
  .tep-stats-row { display: flex; gap: 1rem; flex-wrap: wrap; }
  .tep-stat { display: flex; flex-direction: column; }
  .tep-stat-val { font-size: 0.9rem; font-weight: 700; }
  .tep-stat-lbl { font-size: 0.68rem; color: var(--td); }

  /* History */
  .tep-history-item {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.25rem 0; border-bottom: 1px solid var(--bd);
    font-size: 0.78rem;
  }
  .tep-history-item:last-child { border-bottom: none; }
  .tep-hist-field { color: var(--td); flex-shrink: 0; width: 5.5rem; font-style: italic; }
  .tep-hist-val   { flex: 1; min-width: 0; }
  .tep-hist-date  { color: var(--td); font-size: 0.68rem; flex-shrink: 0; }
</style>
