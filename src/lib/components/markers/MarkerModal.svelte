<script lang="ts">
  import { markersStore } from '$lib/stores/markers.svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { encodeMarkerQr } from '$lib/services/qr-engine';
  import BottomSheet from '../ui/BottomSheet.svelte';
  import QRDisplay from '../qr/QRDisplay.svelte';
  import type { CustomMarker } from '$lib/types';

  interface Props {
    open: boolean;
    marker?: Partial<CustomMarker>;
    lat?: number;
    lng?: number;
    onclose?: () => void;
    onsave?: (m: CustomMarker) => void;
  }
  let { open = $bindable(), marker, lat, lng, onclose, onsave }: Props = $props();

  const EMOJIS = ['📍','⭐','🔥','⚠','🏕','🌊','🗿','🧱','🪵','🚵','🏆','💧','🅿','🚽','🛁'];
  const CATS   = ['point', 'hazard', 'camp', 'water', 'parking', 'other'];

  let name    = $state(marker?.name ?? '');
  let emoji   = $state(marker?.emoji ?? '📍');
  let cat     = $state(marker?.cat ?? 'point');
  let desc    = $state(marker?.desc ?? '');
  let showQr  = $state(false);
  let qrChunks = $state<string[]>([]);

  const posLat = $derived(lat ?? marker?.lat ?? mapStore.gpsPos?.lat ?? 0);
  const posLng = $derived(lng ?? marker?.lng ?? mapStore.gpsPos?.lng ?? 0);
  const mapsUrl = $derived(markersStore.buildMapsUrl(posLat, posLng));

  async function save() {
    if (!name.trim()) { app.toast('Name erforderlich', 'error'); return; }
    const data = {
      name: name.trim(),
      emoji,
      cat,
      desc,
      gmapsUrl: mapsUrl,
      lat:  posLat,
      lng:  posLng,
    };
    const saved = marker?.id
      ? (await markersStore.updateCustomMarker(marker.id, data), markersStore.getCustomMarker(marker.id)!)
      : await markersStore.addCustomMarker(data);
    onsave?.(saved);
    onclose?.();
  }

  function generateQr() {
    qrChunks = [encodeMarkerQr(posLat, posLng, name)];
    showQr   = true;
  }
</script>

<BottomSheet
  {open}
  title={marker?.id ? 'Marker bearbeiten' : 'Neuer Marker'}
  subtitle="{posLat.toFixed(5)}, {posLng.toFixed(5)}"
  {onclose}
>
  {#snippet footer()}
    <button class="btn btn-secondary" onclick={generateQr}>📷 QR</button>
    <button class="btn btn-primary flex-1" onclick={save}>Speichern</button>
  {/snippet}

  <div style="display:flex;flex-direction:column;gap:0.75rem">
    <!-- Name -->
    <div class="form-row">
      <label class="form-label" for="mk-name">Name</label>
      <input id="mk-name" class="input" type="text" bind:value={name} placeholder="Marker-Name" />
    </div>

    <!-- Emoji picker -->
    <div class="form-row">
      <label class="form-label">Emoji</label>
      <div class="emoji-grid">
        {#each EMOJIS as em}
          <button class="emoji-option {emoji === em ? 'selected' : ''}" onclick={() => emoji = em}>{em}</button>
        {/each}
        <!-- Custom input -->
        <input class="input" type="text" bind:value={emoji} maxlength="4"
          style="grid-column:span 2;font-size:1.2rem;text-align:center;padding:0.25rem" />
      </div>
    </div>

    <!-- Desc -->
    <div class="form-row">
      <label class="form-label" for="mk-desc">Beschreibung</label>
      <textarea id="mk-desc" class="input" rows="2" bind:value={desc} placeholder="Optional…"></textarea>
    </div>

    <!-- Maps link -->
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span class="text-xs text-dim">Position: {posLat.toFixed(5)}, {posLng.toFixed(5)}</span>
      <a href={mapsUrl} target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Karte öffnen</a>
    </div>

    {#if showQr && qrChunks.length > 0}
      <div style="border-top:1px solid var(--bd);padding-top:0.75rem">
        <QRDisplay chunks={qrChunks} size={200} />
      </div>
    {/if}
  </div>
</BottomSheet>
