<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { recordingStore } from '$lib/stores/recording.svelte';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { markersStore } from '$lib/stores/markers.svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { FEAT_ICONS } from '$lib/types';
  import TrackList from './TrackList.svelte';
  import RecordingPanel from './RecordingPanel.svelte';
  import type { FeatureType } from '$lib/types';

  interface Props {
    open: boolean;
    onclose?: () => void;
  }
  let { open = $bindable(), onclose }: Props = $props();

  type TabId = 'tracks' | 'recording' | 'markers';
  let tab = $state<TabId>('tracks');

  // Switch to recording tab when recording starts
  $effect(() => {
    if (recordingStore.active) tab = 'recording';
  });

  // Flat list: custom markers + track features from active project
  const allMarkers = $derived([
    ...markersStore.visibleCustom.map(m => ({
      id:    m.id,
      name:  m.name,
      emoji: m.emoji,
      lat:   m.lat,
      lng:   m.lng,
      sub:   null as string | null,
    })),
    ...tracksStore.activeProjectTracks.flatMap(t =>
      tracksStore.getFeatures(t.id).map(f => ({
        id:    f.id ?? `${f.type}-${f.lat.toFixed(5)}-${f.lng.toFixed(5)}`,
        name:  f.name || (FEAT_ICONS[f.type as FeatureType] + ' ' + f.type),
        emoji: FEAT_ICONS[f.type as FeatureType] ?? '📍',
        lat:   f.lat,
        lng:   f.lng,
        sub:   t.name as string | null,
      }))
    ),
  ]);

  function flyToMarker(lat: number, lng: number) {
    (mapStore.map as any)?.flyTo([lat, lng], 17, { animate: true, duration: 0.6 });
    onclose?.();
  }
</script>

<!-- Backdrop -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="settings-backdrop open"
    onclick={onclose}
    role="presentation"
  ></div>
{/if}

<div class="gpx-panel" class:open>
  <!-- Handle -->
  <div style="display:flex;justify-content:center;padding:0.5rem 0 0">
    <div style="width:2.5rem;height:4px;background:var(--bd2);border-radius:2px"></div>
  </div>

  <!-- Header -->
  <div class="panel-header">
    <div class="tabs gpx-tabs" style="margin:0;flex:1">
      <button class="tab {tab === 'tracks' ? 'active' : ''}" onclick={() => tab = 'tracks'}>
        🗺 Tracks ({tracksStore.activeProjectTracks.length})
      </button>
      <button
        class="tab {tab === 'recording' ? 'active' : ''}"
        onclick={() => tab = 'recording'}
        style={recordingStore.active ? 'color:var(--ac)' : ''}
      >
        {recordingStore.active ? '⏺' : '🔴'} Aufnahme
      </button>
      <button class="tab {tab === 'markers' ? 'active' : ''}" onclick={() => tab = 'markers'}>
        📍 ({allMarkers.length})
      </button>
    </div>
    <button class="btn-icon" onclick={onclose} style="margin-left:0.5rem;flex-shrink:0">✕</button>
  </div>

  <!-- Content -->
  <div class="panel-body" style="max-height:60vh;overflow-y:auto">
    {#if tab === 'tracks'}
      <TrackList />
    {:else if tab === 'recording'}
      <RecordingPanel />
    {:else}
      <!-- Markers tab -->
      {#if allMarkers.length === 0}
        <p class="markers-empty">Keine Marker vorhanden</p>
      {:else}
        {#each allMarkers as m (m.id)}
          <button class="marker-row" onclick={() => flyToMarker(m.lat, m.lng)}>
            <span class="marker-emoji">{m.emoji}</span>
            <span class="marker-name">
              {m.name}
              {#if m.sub}
                <span class="marker-sub">{m.sub}</span>
              {/if}
            </span>
            <span style="color:var(--ac);font-weight:700;flex-shrink:0">→</span>
          </button>
        {/each}
      {/if}
    {/if}
  </div>
</div>

<style>
  /* Ensure 3 tabs fit without wrapping */
  .gpx-tabs {
    overflow-x: auto;
    scrollbar-width: none;
    flex-wrap: nowrap;
    display: flex;
  }
  .gpx-tabs::-webkit-scrollbar { display: none; }

  /* Marker list */
  .markers-empty {
    text-align: center;
    color: var(--td);
    font-size: 0.85rem;
    padding: 2rem 1rem;
  }
  .marker-row {
    display: flex; align-items: center; gap: 0.6rem;
    width: 100%; padding: 0.55rem 0.75rem;
    background: none; border: none; color: inherit;
    cursor: pointer; text-align: left;
    border-bottom: 1px solid var(--bd);
    transition: background 0.12s;
  }
  .marker-row:hover { background: var(--s2); }
  .marker-row:last-child { border-bottom: none; }
  .marker-emoji { font-size: 1.2rem; flex-shrink: 0; }
  .marker-name  { flex: 1; font-size: 0.88rem; font-weight: 500; min-width: 0; }
  .marker-sub   {
    display: block;
    font-size: 0.7rem;
    color: var(--td);
    font-weight: 400;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
