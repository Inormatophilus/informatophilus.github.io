<script lang="ts">
  /**
   * FeatPosPickerModal — Schlüsselstellen setzen & bearbeiten
   *
   * Redesigned step-by-step flow:
   * 1. PLACING:     Tap track to place marker (snaps to route)
   * 2. CONFIGURING: Set type, name, difficulty — then confirm
   * 3. After confirm: Add next marker or save & close
   *
   * Mobile-first, track-railing:
   * • 48×48 touch target with 24×24 visual emoji marker (half-size)
   * • Continuous snap-to-track on drag
   * • Map panning disabled during drag
   * • Robust cleanup (touchcancel, onDestroy try-catch)
   */
  import { onMount, onDestroy } from 'svelte';
  import { mapStore }    from '$lib/stores/map.svelte';
  import { tracksStore } from '$lib/stores/tracks.svelte';
  import { app }         from '$lib/stores/app.svelte';
  import { FEAT_ICONS, FEAT_NAMES } from '$lib/types';
  import { nearestPointOnTrack }    from '$lib/services/geo';
  import type { FeatureType, TrackFeature, GpxPoint } from '$lib/types';

  // ── Props ──────────────────────────────────────────────────────────────────
  interface Props {
    trackId:      string;
    editFeature?: TrackFeature | null;
    onclose?:     () => void;
    onsave?:      (feat: TrackFeature) => void;    // edit mode
    onsaveAll?:   (feats: TrackFeature[]) => void; // add mode
  }
  let { trackId, editFeature = null, onclose, onsave, onsaveAll }: Props = $props();

  const isEdit = editFeature != null;

  // ── Internal types ─────────────────────────────────────────────────────────
  interface Pending {
    id:        string;
    type:      FeatureType;
    name:      string;
    diff:      1 | 2 | 3;
    lat:       number;
    lng:       number;
    confirmed: boolean;
  }

  // Session state: 'placing' = waiting for user to tap track, 'configuring' = editing a marker
  type SessionState = 'placing' | 'configuring';

  // ── Reactive state ─────────────────────────────────────────────────────────
  let markers = $state<Pending[]>(
    isEdit ? [{
      id:        editFeature!.id ?? `pe_${Date.now()}`,
      type:      (editFeature!.type ?? 'rock') as FeatureType,
      name:      editFeature!.name ?? '',
      diff:      (Math.max(1, Math.min(3, editFeature!.diff ?? 2))) as 1 | 2 | 3,
      lat:       editFeature!.lat,
      lng:       editFeature!.lng,
      confirmed: true,
    }] : []
  );

  let session     = $state<SessionState>(isEdit ? 'configuring' : 'placing');
  let activeId    = $state<string | null>(isEdit ? (editFeature!.id ?? null) : null);
  let lastType    = $state<FeatureType>('rock');
  let noTrack     = $state(false);
  let justConfirmedId = $state<string | null>(null); // brief glow animation

  const active    = $derived(markers.find(m => m.id === activeId) ?? null);
  const confirmed = $derived(markers.filter(m => m.confirmed));

  // ── Non-reactive Leaflet state ─────────────────────────────────────────────
  let _L:      typeof import('leaflet') | null = null;
  let _pts:    GpxPoint[] = [];
  let _clickH: ((e: any) => void) | null = null;
  let _isDrag  = false;
  let _clickGuardTs = 0; // prevents confirm-click from propagating to map
  const _mkrs  = new Map<string, import('leaflet').Marker>();

  // ── Constant data ──────────────────────────────────────────────────────────
  const TYPES = Object.keys(FEAT_ICONS) as FeatureType[];
  const DIFFS: { v: 1|2|3; label: string; short: string; emoji: string; c: string }[] = [
    { v: 1, label: 'Anfänger', short: 'A', emoji: '🟢', c: '#22c55e' },
    { v: 2, label: 'Mittel',   short: 'M', emoji: '🟡', c: '#f59e0b' },
    { v: 3, label: 'Expert',   short: 'E', emoji: '🔴', c: '#ef4444' },
  ];

  // Type categories for visual grouping
  const TYPE_GROUPS: { label: string; types: FeatureType[] }[] = [
    { label: 'Hindernisse', types: ['drop', 'gap', 'root', 'rock', 'steinfeld', 'verblockt', 'steil', 'northshore'] },
    { label: 'Aktionen',    types: ['sprung', 'flow'] },
    { label: 'Landmarken',  types: ['aussicht', 'goal', 'pause'] },
  ];

  // ── Icon builder ───────────────────────────────────────────────────────────
  function mkIcon(type: FeatureType, isActive: boolean, isConfirmed: boolean) {
    if (!_L) return null;
    const emoji = FEAT_ICONS[type] ?? '📍';
    const ring  = isActive
      ? '#c8ff00'
      : isConfirmed
        ? 'rgba(34,197,94,0.7)'
        : 'rgba(255,255,255,0.35)';
    const glow  = isActive
      ? '0 0 0 3px rgba(200,255,0,0.3),'
      : isConfirmed
        ? '0 0 0 2px rgba(34,197,94,0.25),'
        : '';
    return _L.divIcon({
      className: '',
      // 48×48 invisible touch target, 24×24 visual marker (half-size)
      html: `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;touch-action:none;cursor:grab">` +
            `<div style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;` +
            `font-size:0.95rem;line-height:1;background:rgba(6,10,20,0.88);` +
            `border:2px solid ${ring};box-shadow:${glow}0 2px 12px rgba(0,0,0,0.85);` +
            `transition:border-color 0.15s,box-shadow 0.15s">${emoji}</div></div>`,
      iconSize:   [48, 48],
      iconAnchor: [24, 24],
    });
  }

  // ── Track snap ─────────────────────────────────────────────────────────────
  function snap(lat: number, lng: number): { lat: number; lng: number } {
    if (_pts.length < 2) return { lat, lng };
    return nearestPointOnTrack({ lat, lng }, _pts);
  }

  // ── Add a Leaflet marker ───────────────────────────────────────────────────
  function addLeafletMarker(p: Pending) {
    if (!_L || !mapStore.map) return;

    const m = _L.marker([p.lat, p.lng], {
      draggable:    true,
      icon:         mkIcon(p.type, p.id === activeId, p.confirmed)!,
      zIndexOffset: 950,
      interactive:  true,
      bubblingMouseEvents: false,
    }).addTo(mapStore.map);

    // Tap → select for re-editing
    m.on('click', () => {
      if (!_isDrag) {
        activeId = p.id;
        session  = 'configuring';
        refreshIcons();
      }
    });

    // Disable map panning during grab
    m.on('mousedown touchstart', () => {
      mapStore.map?.dragging.disable();
    });

    // RAILING: snap on every drag event
    m.on('drag', () => {
      if (!_isDrag) {
        _isDrag  = true;
        activeId = p.id;
        session  = 'configuring';
        refreshIcons();
      }
      const pos = m.getLatLng();
      const s   = snap(pos.lat, pos.lng);
      m.setLatLng([s.lat, s.lng]);
    });

    // Drag ended: update reactive state + re-enable panning
    m.on('dragend', () => {
      mapStore.map?.dragging.enable();
      const pos = m.getLatLng();
      const s   = snap(pos.lat, pos.lng);
      m.setLatLng([s.lat, s.lng]);
      markers = markers.map(x => x.id === p.id ? { ...x, lat: s.lat, lng: s.lng } : x);
      setTimeout(() => { _isDrag = false; }, 80);
    });

    // Safety: always re-enable panning
    m.on('touchend touchcancel', () => {
      mapStore.map?.dragging.enable();
    });

    _mkrs.set(p.id, m);
  }

  // ── Refresh all marker icons ───────────────────────────────────────────────
  function refreshIcons() {
    for (const [id, m] of _mkrs) {
      const p = markers.find(x => x.id === id);
      if (p && _L) {
        const ic = mkIcon(p.type, id === activeId, p.confirmed);
        if (ic) m.setIcon(ic);
      }
    }
  }

  // ── Place a new marker ─────────────────────────────────────────────────────
  function placeAt(lat: number, lng: number) {
    if (_isDrag || session === 'configuring') return;
    const s  = snap(lat, lng);
    const id = `pf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const p: Pending = {
      id, type: lastType, name: '', diff: 2,
      lat: s.lat, lng: s.lng, confirmed: false
    };
    markers  = [...markers, p];
    activeId = id;
    session  = 'configuring';
    addLeafletMarker(p);
    refreshIcons();
    mapStore.map?.panTo([s.lat, s.lng], { animate: true, duration: 0.3 });
  }

  function selectAndPan(id: string) {
    activeId = id;
    session  = 'configuring';
    const p = markers.find(x => x.id === id);
    if (p) mapStore.map?.panTo([p.lat, p.lng], { animate: true });
    refreshIcons();
  }

  function patch(changes: Partial<Omit<Pending, 'id'>>) {
    if (!activeId) return;
    if (changes.type) lastType = changes.type;
    markers = markers.map(p => p.id === activeId ? { ...p, ...changes } : p);
    if (changes.type) {
      const m = _mkrs.get(activeId);
      const p = markers.find(x => x.id === activeId);
      if (m && _L && p) {
        const ic = mkIcon(changes.type, true, p.confirmed);
        if (ic) m.setIcon(ic);
      }
    }
  }

  // ── Confirm the active marker ──────────────────────────────────────────────
  function confirmActive() {
    if (!activeId) return;
    const p = markers.find(x => x.id === activeId);
    if (!p) return;
    // Set name to type default if empty
    if (!p.name) p.name = '';
    markers = markers.map(x => x.id === activeId ? { ...x, confirmed: true } : x);
    justConfirmedId = activeId;
    setTimeout(() => { justConfirmedId = null; }, 1200);

    // In edit mode, save immediately
    if (isEdit) {
      save();
      return;
    }

    // Guard: prevent the confirm-click from propagating to Leaflet map
    _clickGuardTs = Date.now();

    // Switch back to placing mode
    activeId = null;
    session  = 'placing';
    refreshIcons();

    // Re-enable map clicks
    enableMapClicks();
  }

  // ── Discard active (unconfirmed) marker ────────────────────────────────────
  function discardActive() {
    if (!activeId) return;
    const m = _mkrs.get(activeId);
    if (m && mapStore.map) mapStore.map.removeLayer(m);
    _mkrs.delete(activeId);
    markers  = markers.filter(x => x.id !== activeId);
    _clickGuardTs = Date.now();
    activeId = null;
    session  = 'placing';
    refreshIcons();
    enableMapClicks();
  }

  // ── Remove a confirmed marker ─────────────────────────────────────────────
  function removeConfirmed(id: string) {
    const m = _mkrs.get(id);
    if (m && mapStore.map) mapStore.map.removeLayer(m);
    _mkrs.delete(id);
    markers = markers.filter(x => x.id !== id);
    if (activeId === id) {
      activeId = null;
      session  = 'placing';
    }
    refreshIcons();
  }

  // ── Add marker at map center ───────────────────────────────────────────────
  function addCenter() {
    if (!mapStore.map) return;
    const c = mapStore.map.getCenter();
    placeAt(c.lat, c.lng);
  }

  // ── Add marker at GPS position ─────────────────────────────────────────────
  function addGps() {
    if (!mapStore.gpsPos) { app.toast('Kein GPS-Signal', 'warn'); return; }
    placeAt(mapStore.gpsPos.lat, mapStore.gpsPos.lng);
  }

  // ── Enable/disable map click handler ───────────────────────────────────────
  function enableMapClicks() {
    if (!mapStore.map || isEdit) return;
    if (_clickH) mapStore.map.off('click', _clickH);
    _clickH = (e: any) => {
      // Guard: ignore clicks within 300ms of confirm (prevents click propagation to Leaflet)
      if (Date.now() - _clickGuardTs < 300) return;
      if (e.latlng && !_isDrag && session === 'placing') {
        placeAt(e.latlng.lat, e.latlng.lng);
      }
    };
    mapStore.map.on('click', _clickH);
  }

  function disableMapClicks() {
    if (!mapStore.map || !_clickH) return;
    mapStore.map.off('click', _clickH);
    _clickH = null;
  }

  // ── Save all confirmed markers ─────────────────────────────────────────────
  function save() {
    if (isEdit) {
      if (!markers.length) { onclose?.(); return; }
      const p = markers[0];
      onsave?.({
        id:   editFeature!.id,
        type: p.type,
        name: p.name || FEAT_NAMES[p.type],
        diff: p.diff,
        date: editFeature!.date ?? Date.now(),
        lat:  p.lat,
        lng:  p.lng,
      });
    } else {
      const toSave = markers.filter(m => m.confirmed);
      if (!toSave.length) { onclose?.(); return; }
      const now = Date.now();
      onsaveAll?.(toSave.map((p, i) => ({
        id:   `feat_${now + i}_${Math.random().toString(36).slice(2, 6)}`,
        type: p.type,
        name: p.name || FEAT_NAMES[p.type],
        diff: p.diff,
        date: now,
        lat:  p.lat,
        lng:  p.lng,
      })));
    }
  }

  // ── Close with safety check ────────────────────────────────────────────────
  function handleClose() {
    if (confirmed.length > 0 && !isEdit) {
      if (!confirm(`${confirmed.length} Schlüsselstelle${confirmed.length !== 1 ? 'n' : ''} nicht gespeichert. Trotzdem schließen?`)) {
        return;
      }
    }
    onclose?.();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  onMount(async () => {
    if (!mapStore.map) {
      app.toast('Karte nicht verfügbar', 'error');
      onclose?.();
      return;
    }

    _pts = tracksStore.getPointsForTrack(trackId);
    if (_pts.length < 2) noTrack = true;

    _L = await import('leaflet');
    app.enterFeaturePlacement();

    if (!isEdit) {
      enableMapClicks();
    }

    // Edit mode: render existing marker
    if (isEdit && markers.length) {
      addLeafletMarker(markers[0]);
    }

    // Zoom to track
    const track = tracksStore.getTrack(trackId);
    if (track?.bounds) {
      mapStore.map.fitBounds(
        [[track.bounds.south, track.bounds.west], [track.bounds.north, track.bounds.east]],
        { padding: [20, 20] }
      );
    } else if (isEdit && editFeature) {
      mapStore.map.setView([editFeature.lat, editFeature.lng], 17);
    }
  });

  onDestroy(() => {
    try {
      if (mapStore.map) {
        if (_clickH) mapStore.map.off('click', _clickH);
        mapStore.map.dragging.enable();
      }
    } catch { /* ignore */ }

    for (const m of _mkrs.values()) {
      try { if (mapStore.map) mapStore.map.removeLayer(m); } catch { /* ignore */ }
    }
    _mkrs.clear();
    app.exitFeaturePlacement();
  });
</script>

<!--
  PLACEMENT STRIP — Fixed bottom sheet
  z-index: 350 → über Panel(300), unter Modal(400)
  Safe-area für Home-Bar auf iOS
-->
<div class="ks-strip" role="dialog" aria-modal="false" aria-label="Schlüsselstelle setzen">

  <!-- ── HEADER ──────────────────────────────────────────────────────── -->
  <div class="ks-hdr">
    <div class="ks-hdr-left">
      <span class="ks-hdr-icon">{isEdit ? '✏️' : '🏔️'}</span>
      <span class="ks-hdr-title">{isEdit ? 'Schlüsselstelle bearbeiten' : 'Schlüsselstellen setzen'}</span>
    </div>
    {#if !isEdit && confirmed.length > 0}
      <span class="ks-badge">{confirmed.length}</span>
    {/if}
  </div>

  <!-- ── CONFIRMED MARKERS CHIPS ─────────────────────────────────────── -->
  {#if !isEdit && markers.length > 0}
    <div class="ks-chips" role="toolbar" aria-label="Gesetzte Schlüsselstellen">
      {#each markers as m, i (m.id)}
        <button
          class="ks-chip"
          class:ks-chip-active={m.id === activeId}
          class:ks-chip-confirmed={m.confirmed && m.id !== activeId}
          class:ks-chip-glow={m.id === justConfirmedId}
          onclick={() => selectAndPan(m.id)}
          title="{FEAT_NAMES[m.type]} #{i + 1}"
          aria-pressed={m.id === activeId}
        >
          <span class="ks-chip-emoji">{FEAT_ICONS[m.type]}</span>
          <span class="ks-chip-num">{i + 1}</span>
          {#if m.confirmed && m.id !== activeId}
            <span class="ks-chip-check">✓</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- ── CONTENT AREA ─────────────────────────────────────────────────── -->
  <div class="ks-content">

    <!-- ═══ CONFIGURING: Type/Name/Diff editor ═══ -->
    {#if session === 'configuring' && active}

      <!-- Type selector grid -->
      <div class="ks-type-section">
        <div class="ks-label">Hindernisklasse</div>
        <div class="ks-type-grid" role="group" aria-label="Typ wählen">
          {#each TYPES as t}
            <button
              class="ks-type-btn"
              class:ks-type-sel={active.type === t}
              onclick={() => patch({ type: t })}
              title={FEAT_NAMES[t]}
              aria-pressed={active.type === t}
            >
              <span class="ks-type-emoji">{FEAT_ICONS[t]}</span>
              <span class="ks-type-label">{FEAT_NAMES[t]}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Name / Description -->
      <div class="ks-field">
        <div class="ks-label">Beschreibung</div>
        <div class="ks-name-row">
          <input
            class="ks-input"
            type="text"
            value={active.name}
            placeholder={FEAT_NAMES[active.type]}
            oninput={(e) => patch({ name: (e.target as HTMLInputElement).value })}
            aria-label="Name der Schlüsselstelle"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          />
          <span class="ks-coords" title="GPS">
            {active.lat.toFixed(4)}, {active.lng.toFixed(4)}
          </span>
        </div>
      </div>

      <!-- Difficulty + Actions -->
      <div class="ks-meta">
        <div class="ks-diff-group">
          <div class="ks-label">Schwierigkeit</div>
          <div class="ks-diffs" role="group" aria-label="Schwierigkeit">
            {#each DIFFS as d}
              <button
                class="ks-diff"
                class:ks-diff-sel={active.diff === d.v}
                style={active.diff === d.v
                  ? `background:${d.c};border-color:${d.c};color:#000`
                  : ''}
                onclick={() => patch({ diff: d.v })}
                title={d.label}
                aria-pressed={active.diff === d.v}
              >
                <span>{d.emoji}</span>
                <span>{d.label}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Config actions -->
      <div class="ks-config-actions">
        <button class="ks-btn ks-btn-ghost" onclick={discardActive}>
          {active.confirmed ? '↩ Zurück' : '✕ Verwerfen'}
        </button>

        {#if !isEdit && active.confirmed}
          <button
            class="ks-btn ks-btn-danger-sm"
            onclick={() => removeConfirmed(active.id)}
            title="Schlüsselstelle entfernen"
          >🗑</button>
        {/if}

        <button class="ks-btn ks-btn-confirm" onclick={confirmActive}>
          ✓ {isEdit ? 'Speichern' : 'Bestätigen'}
        </button>
      </div>

    <!-- ═══ PLACING: Onboarding / Between markers ═══ -->
    {:else if session === 'placing'}

      {#if markers.length === 0}
        <!-- Onboarding: no markers yet -->
        <div class="ks-onboard">
          {#if noTrack}
            <div class="ks-warn">⚠️ Strecke noch nicht geladen — Marker wird frei platziert</div>
          {/if}
          <div class="ks-onboard-row">
            <span class="ks-onboard-icon">👆</span>
            <div>
              <div class="ks-onboard-title">Auf die Strecke tippen</div>
              <div class="ks-onboard-desc">
                Der Marker rastet automatisch auf der Strecke ein.
                Verschieben = entlang der Strecke railen.
              </div>
            </div>
          </div>
          <div class="ks-onboard-btns">
            {#if mapStore.gpsPos}
              <button class="ks-btn ks-btn-secondary" onclick={addGps}>📍 GPS-Position</button>
            {/if}
            <button class="ks-btn ks-btn-secondary" onclick={addCenter}>+ Kartenmitte</button>
          </div>
        </div>

      {:else}
        <!-- Between markers: show success + options -->
        <div class="ks-between">
          {#if justConfirmedId}
            <div class="ks-success">
              <span class="ks-success-icon">✅</span>
              <span>Schlüsselstelle bestätigt!</span>
            </div>
          {/if}

          <div class="ks-between-hint">
            Strecke antippen oder:
          </div>

          <div class="ks-between-btns">
            {#if mapStore.gpsPos}
              <button class="ks-btn ks-btn-secondary" onclick={addGps}>📍 An GPS-Position</button>
            {/if}
            <button class="ks-btn ks-btn-secondary" onclick={addCenter}>+ An Kartenmitte</button>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- ── ACTION BAR ───────────────────────────────────────────────────── -->
  <div class="ks-actions">
    {#if session === 'placing'}
      <button class="ks-btn ks-btn-ghost" onclick={handleClose}>
        {confirmed.length > 0 ? '✕ Abbrechen' : '✕ Schließen'}
      </button>
      {#if confirmed.length > 0}
        <button class="ks-btn ks-btn-save" onclick={save}>
          💾 Speichern & Schließen ({confirmed.length})
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* ================================================================
     STRIP — Fixed bottom sheet
     ================================================================ */
  .ks-strip {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 350;
    pointer-events: auto;

    background: var(--s1);
    border-top: 2.5px solid var(--ac);
    border-radius: 1.1rem 1.1rem 0 0;
    box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.6);

    display: flex;
    flex-direction: column;
    max-height: 52vh;

    padding-bottom: env(safe-area-inset-bottom, 0px);
    animation: ks-slideUp 0.28s cubic-bezier(.32,.72,0,1);
  }

  @keyframes ks-slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  /* ── Header ────────────────────────────────────────────────────── */
  .ks-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem 0.45rem;
    border-bottom: 1px solid var(--bd);
    flex-shrink: 0;
  }
  .ks-hdr-left {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .ks-hdr-icon {
    font-size: 0.95rem;
    flex-shrink: 0;
  }
  .ks-hdr-title {
    font-family: var(--fh);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ks-badge {
    min-width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--ac);
    color: #000;
    font-size: 0.72rem;
    font-weight: 800;
    font-family: var(--fh);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* ── Chips ─────────────────────────────────────────────────────── */
  .ks-chips {
    display: flex;
    gap: 0.3rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0.35rem 1rem;
    align-items: center;
    min-height: 48px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--bd);
  }
  .ks-chips::-webkit-scrollbar { display: none; }

  .ks-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 0.2rem 0.4rem;
    border-radius: 0.55rem;
    border: 1.5px solid var(--bd2);
    background: var(--s2);
    cursor: pointer;
    flex-shrink: 0;
    min-width: 42px;
    touch-action: manipulation;
    transition: border-color 0.12s, background 0.12s, box-shadow 0.12s, transform 0.1s;
  }
  .ks-chip:active { transform: scale(0.93); }

  .ks-chip-active {
    border-color: var(--ac);
    background: var(--s3);
    box-shadow: 0 0 0 2px rgba(200,255,0,0.3);
  }
  .ks-chip-confirmed {
    border-color: rgba(34,197,94,0.5);
    background: rgba(34,197,94,0.08);
  }
  .ks-chip-glow {
    animation: ks-chipGlow 1.2s ease-out;
  }
  @keyframes ks-chipGlow {
    0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
    50%  { box-shadow: 0 0 0 6px rgba(34,197,94,0.2); }
    100% { box-shadow: none; }
  }

  .ks-chip-emoji { font-size: 1.15rem; line-height: 1; }
  .ks-chip-num {
    font-size: 0.55rem;
    font-weight: 800;
    font-family: var(--fh);
    color: var(--td);
    margin-top: 1px;
  }
  .ks-chip-active .ks-chip-num { color: var(--ac); }
  .ks-chip-confirmed .ks-chip-num { color: #22c55e; }

  .ks-chip-check {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #22c55e;
    color: #000;
    font-size: 0.5rem;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  /* ── Content ────────────────────────────────────────────────────── */
  .ks-content {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
  }

  /* ── Labels ─────────────────────────────────────────────────────── */
  .ks-label {
    font-family: var(--fh);
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--td);
    margin-bottom: 0.25rem;
  }

  /* ── Type grid ──────────────────────────────────────────────────── */
  .ks-type-section { flex-shrink: 0; }

  .ks-type-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 0.25rem;
  }

  .ks-type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 0.3rem 0.15rem;
    border-radius: 0.5rem;
    border: 1.5px solid var(--bd2);
    background: var(--s2);
    cursor: pointer;
    touch-action: manipulation;
    transition: border-color 0.1s, background 0.1s, transform 0.08s;
  }
  .ks-type-btn:active { transform: scale(0.93); }
  .ks-type-sel {
    border-color: var(--ac);
    background: rgba(200,255,0,0.08);
    box-shadow: inset 0 0 0 1px rgba(200,255,0,0.15);
  }
  .ks-type-emoji { font-size: 1.1rem; line-height: 1; }
  .ks-type-label {
    font-size: 0.52rem;
    font-family: var(--fh);
    font-weight: 600;
    color: var(--td);
    text-align: center;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .ks-type-sel .ks-type-label { color: var(--ac); }

  /* ── Name row ───────────────────────────────────────────────────── */
  .ks-field { flex-shrink: 0; }

  .ks-name-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .ks-input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    border-radius: 0.4rem;
    border: 1px solid var(--bd2);
    background: var(--s2);
    color: var(--tx);
    font-size: 0.82rem;
    font-family: var(--fb);
    outline: none;
    transition: border-color 0.12s;
  }
  .ks-input:focus { border-color: var(--ac); }
  .ks-input::placeholder { color: var(--td); opacity: 0.6; }

  .ks-coords {
    font-size: 0.55rem;
    font-family: monospace;
    color: var(--td);
    flex-shrink: 0;
    background: var(--s2);
    border: 1px solid var(--bd2);
    border-radius: 0.25rem;
    padding: 0.15rem 0.3rem;
    white-space: nowrap;
  }

  /* ── Difficulty ─────────────────────────────────────────────────── */
  .ks-meta { flex-shrink: 0; }
  .ks-diff-group { display: flex; flex-direction: column; }

  .ks-diffs {
    display: flex;
    gap: 0.25rem;
  }
  .ks-diff {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    height: 34px;
    border-radius: 0.5rem;
    border: 1.5px solid var(--bd2);
    background: var(--s2);
    color: var(--tx);
    cursor: pointer;
    font-size: 0.72rem;
    font-family: var(--fh);
    font-weight: 600;
    touch-action: manipulation;
    transition: background 0.1s, border-color 0.1s, color 0.1s, transform 0.08s;
  }
  .ks-diff:active { transform: scale(0.95); }
  .ks-diff-sel { font-weight: 800; }

  /* ── Config actions ─────────────────────────────────────────────── */
  .ks-config-actions {
    display: flex;
    gap: 0.35rem;
    padding-top: 0.2rem;
    flex-shrink: 0;
  }

  /* ── Onboarding ─────────────────────────────────────────────────── */
  .ks-onboard {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .ks-warn {
    font-size: 0.7rem;
    color: #f59e0b;
    background: rgba(245,158,11,0.1);
    border: 1px solid rgba(245,158,11,0.3);
    border-radius: 0.4rem;
    padding: 0.25rem 0.5rem;
    line-height: 1.4;
  }
  .ks-onboard-row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
  }
  .ks-onboard-icon {
    font-size: 1.8rem;
    flex-shrink: 0;
    line-height: 1;
    animation: ks-pulse 2s ease-in-out infinite;
  }
  @keyframes ks-pulse {
    0%, 100% { transform: scale(1);   opacity: 1; }
    50%      { transform: scale(1.1); opacity: 0.7; }
  }
  .ks-onboard-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--tx);
    margin-bottom: 0.15rem;
  }
  .ks-onboard-desc {
    font-size: 0.7rem;
    color: var(--td);
    line-height: 1.45;
  }
  .ks-onboard-btns {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .ks-onboard-btns .ks-btn { flex: 1; min-width: 110px; }

  /* ── Between markers ────────────────────────────────────────────── */
  .ks-between {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
    text-align: center;
  }
  .ks-success {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    background: rgba(34,197,94,0.1);
    border: 1px solid rgba(34,197,94,0.3);
    border-radius: 0.5rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: #22c55e;
    animation: ks-fadeIn 0.3s ease-out;
  }
  .ks-success-icon { font-size: 1rem; }

  @keyframes ks-fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .ks-between-hint {
    font-size: 0.72rem;
    color: var(--td);
    font-style: italic;
  }
  .ks-between-btns {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    width: 100%;
  }
  .ks-between-btns .ks-btn { flex: 1; min-width: 110px; }

  /* ── Action bar ─────────────────────────────────────────────────── */
  .ks-actions {
    display: flex;
    gap: 0.35rem;
    padding: 0.45rem 1rem 0.55rem;
    border-top: 1px solid var(--bd);
    flex-shrink: 0;
  }

  /* ── Buttons ────────────────────────────────────────────────────── */
  .ks-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.4rem 0.7rem;
    border-radius: 0.5rem;
    font-family: var(--fh);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
    transition: background 0.1s, transform 0.08s, opacity 0.1s;
    white-space: nowrap;
    border: 1.5px solid var(--bd2);
    background: var(--s2);
    color: var(--tx);
  }
  .ks-btn:active { transform: scale(0.95); }

  .ks-btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--td);
  }
  .ks-btn-ghost:hover { color: var(--tx); }

  .ks-btn-secondary {
    background: var(--s2);
    border-color: var(--bd2);
  }

  .ks-btn-confirm {
    flex: 1;
    background: var(--ac);
    border-color: var(--ac);
    color: #000;
    font-weight: 800;
  }
  .ks-btn-confirm:hover { opacity: 0.9; }

  .ks-btn-save {
    flex: 1;
    background: #22c55e;
    border-color: #22c55e;
    color: #000;
    font-weight: 800;
  }
  .ks-btn-save:hover { opacity: 0.9; }

  .ks-btn-danger-sm {
    background: rgba(239,68,68,0.1);
    border-color: rgba(239,68,68,0.4);
    color: #ef4444;
    padding: 0.35rem 0.55rem;
  }
  .ks-btn-danger-sm:active { background: rgba(239,68,68,0.2); }

</style>
