<script lang="ts">
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { projectsStore } from '$lib/stores/projects.svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { CAT_COLORS, CAT_EMOJIS } from '$lib/types';
  import TrackEditPanel from './TrackEditPanel.svelte';

  let filterProjId   = $state<string | null>(null);
  let editingTrackId = $state<string | null>(null);

  const displayTracks = $derived(
    tracksStore.tracks.filter(t =>
      !filterProjId || t.projectId === filterProjId
    )
  );

  function fitTrack(id: string) {
    const track = tracksStore.getTrack(id);
    if (!track?.bounds || !mapStore.map) return;
    mapStore.fitBounds([
      [track.bounds.south, track.bounds.west],
      [track.bounds.north, track.bounds.east]
    ]);
    // NOTE: do NOT call app.closeSettings() here — see MEMORY.md
  }
</script>

{#if editingTrackId}
  <TrackEditPanel trackId={editingTrackId} onback={() => editingTrackId = null} />
{:else}
  <div style="padding-top:0.75rem">
    <!-- Project filter -->
    <div style="margin-bottom:0.75rem">
      <select class="input" onchange={(e) => filterProjId = (e.target as HTMLSelectElement).value || null}>
        <option value="">Alle Projekte ({tracksStore.tracks.length})</option>
        {#each projectsStore.projects as proj}
          <option value={proj.id}>{proj.name}</option>
        {/each}
      </select>
    </div>

    {#if displayTracks.length === 0}
      <p class="text-dim text-sm" style="text-align:center;padding:2rem">
        Noch keine Tracks geladen
      </p>
    {:else}
      <div style="display:flex;flex-direction:column;gap:0.4rem">
        {#each displayTracks as track}
          <div class="card card-sm" style="border-left:4px solid {CAT_COLORS[track.cat] ?? 'var(--ac)'}">
            <div style="display:flex;align-items:center;gap:0.4rem">
              <span style="font-size:1rem">{CAT_EMOJIS[track.cat] ?? '🟣'}</span>
              <span class="truncate" style="flex:1;font-size:0.9rem;font-weight:500">{track.name}</span>
              <label class="toggle" style="flex-shrink:0" title="Sichtbar">
                <input type="checkbox" checked={track.visible}
                  onchange={() => tracksStore.toggleTrack(track.id)} />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div style="display:flex;gap:0.3rem;margin-top:0.4rem">
              <span class="text-xs text-dim">{track.stats.distKm.toFixed(1)} km</span>
              <span class="text-xs text-dim">↑{track.stats.elevGain.toFixed(0)}m</span>
            </div>
            <div style="display:flex;gap:0.3rem;margin-top:0.4rem">
              <!-- Fit / Fly to track -->
              <button class="btn btn-ghost btn-sm" onclick={() => fitTrack(track.id)}
                title="Auf Karte zeigen">📍</button>
              <!-- Edit track -->
              <button class="btn btn-ghost btn-sm" onclick={() => editingTrackId = track.id}
                title="Strecke bearbeiten">⚙️</button>
              <!-- Share / Export GPX -->
              <button class="btn btn-ghost btn-sm" title="Teilen"
                onclick={async () => {
                  const gpx = await tracksStore.getGpxWithFeatures(track.id);
                  if (!gpx) return;
                  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
                  if (navigator.share) {
                    navigator.share({ title: track.name, files: [new File([blob], track.name + '.gpx')] })
                      .catch(() => {});
                  } else {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = track.name + '.gpx';
                    a.click();
                  }
                }}>📤</button>
              <!-- Delete -->
              <button class="btn btn-ghost btn-sm" style="color:#ef4444"
                onclick={() => { if (confirm(`"${track.name}" löschen?`)) tracksStore.removeTrack(track.id); }}
                title="Löschen">🗑</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
