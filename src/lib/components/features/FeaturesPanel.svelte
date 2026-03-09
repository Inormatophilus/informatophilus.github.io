<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { FEAT_ICONS, FEAT_NAMES } from '$lib/types';
  import FeatPosPickerModal from './FeatPosPickerModal.svelte';
  import type { FeatureType, GmtwTrack, TrackFeature } from '$lib/types';

  interface Props {
    track: GmtwTrack;
  }
  let { track }: Props = $props();

  const features = $derived(tracksStore.getFeatures(track.id));
  let addingFeature  = $state(false);
  let editingFeature = $state<TrackFeature | null>(null);

  const DIFF_LABELS: Record<number, { label: string; color: string }> = {
    1: { label: 'Beginner', color: '#22c55e' },
    2: { label: 'Mittel',   color: '#f59e0b' },
    3: { label: 'Expert',   color: '#ef4444' },
  };
</script>

<div style="display:flex;flex-direction:column;gap:0.5rem">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div class="form-label">Features ({features.length})</div>
    <button class="btn btn-secondary btn-sm" onclick={() => addingFeature = true}>+ Feature</button>
  </div>

  {#each features as feat}
    <div class="card card-sm" style="display:flex;align-items:center;gap:0.5rem">
      <span style="font-size:1.2rem">{FEAT_ICONS[feat.type as FeatureType] ?? '📍'}</span>
      <div style="flex:1">
        <div class="text-sm font-head">{feat.name || FEAT_NAMES[feat.type as FeatureType]}</div>
        <div class="text-xs text-dim" style="display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap">
          {#if DIFF_LABELS[feat.diff]}
            <span style="font-size:0.65rem;padding:1px 5px;border-radius:3px;background:{DIFF_LABELS[feat.diff].color};color:#000;font-weight:700">
              {DIFF_LABELS[feat.diff].label}
            </span>
          {/if}
          <span>{feat.lat.toFixed(4)}, {feat.lng.toFixed(4)}</span>
        </div>
      </div>
      <button class="btn-icon" style="width:1.8rem;height:1.8rem;font-size:0.75rem"
        onclick={() => editingFeature = feat} title="Bearbeiten">✏️</button>
      <button class="btn-icon" style="width:1.8rem;height:1.8rem;font-size:0.75rem;color:#ef4444"
        onclick={() => { if (confirm('Feature löschen?')) tracksStore.removeFeature(track.id, feat.id!); }}
        title="Löschen">🗑</button>
    </div>
  {/each}

  {#if features.length === 0}
    <p class="text-sm text-dim">Noch keine Features. Füge Punkte hinzu um Streckenabschnitte zu markieren.</p>
  {/if}
</div>

{#if addingFeature || editingFeature}
  <FeatPosPickerModal
    trackId={track.id}
    editFeature={editingFeature}
    onclose={() => { addingFeature = false; editingFeature = null; }}
    onsave={async (feat) => {
      if (editingFeature?.id) {
        await tracksStore.updateFeature(track.id, editingFeature.id, feat);
        tracksStore.renderFeatureMarkersOnMap(track);
      }
      editingFeature = null;
    }}
    onsaveAll={async (feats) => {
      for (const f of feats) {
        await tracksStore.addFeature(track.id, f);
      }
      tracksStore.renderFeatureMarkersOnMap(track);
      addingFeature = false;
    }}
  />
{/if}
