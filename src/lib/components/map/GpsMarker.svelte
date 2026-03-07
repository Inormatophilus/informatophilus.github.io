<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte';
  import { app } from '$lib/stores/app.svelte';

  let marker: import('leaflet').Marker | null = null;
  let accuracyCircle: import('leaflet').Circle | null = null;

  function calcSize(zoom: number): number {
    return Math.max(24, Math.min(52, 16 + zoom * 1.3));
  }

  $effect(() => {
    // ── Synchronous reactive reads (tracked by Svelte 5) ──────────────────
    const pos             = mapStore.gpsPos;
    const m               = mapStore.map;
    const emoji           = app.gpsEmoji;
    const deviceHeading   = mapStore.gpsHeading;
    const moveHeading     = mapStore.gpsMovementHeading;
    const accuracy        = mapStore.gpsAccuracy;

    if (!m) return;

    // Preferred: device compass, fallback: movement-derived heading
    const heading = deviceHeading ?? moveHeading;

    (async () => {
      const L = await import('leaflet');

      if (!pos) {
        if (marker)        { m.removeLayer(marker);        marker        = null; }
        if (accuracyCircle){ m.removeLayer(accuracyCircle); accuracyCircle = null; }
        return;
      }

      const zoom = m.getZoom();
      const size = calcSize(zoom);

      // Direction arrow (rotating layer) — only shown when heading is known
      const arrowHtml = heading !== null
        ? `<div style="position:absolute;inset:0;transform:rotate(${heading}deg);pointer-events:none">` +
          `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);` +
          `width:0;height:0;` +
          `border-left:4px solid transparent;border-right:4px solid transparent;` +
          `border-bottom:9px solid rgba(200,255,0,0.95);` +
          `filter:drop-shadow(0 0 3px rgba(200,255,0,0.7))"></div></div>`
        : '';

      const icon = L.divIcon({
        className: 'gps-marker',
        html:
          `<div style="position:relative;width:${size}px;height:${size}px">` +
          arrowHtml +
          `<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);` +
          `font-size:${Math.round(size * 0.65)}px;line-height:1;display:block;` +
          `filter:drop-shadow(0 0 4px rgba(200,255,0,0.7))">${emoji}</span>` +
          `</div>`,
        iconSize:   [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      if (marker) {
        marker.setLatLng([pos.lat, pos.lng]);
        marker.setIcon(icon);
      } else {
        marker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: 1000 }).addTo(m);
      }

      // Accuracy circle
      if (accuracy > 0) {
        if (accuracyCircle) {
          accuracyCircle.setLatLng([pos.lat, pos.lng]);
          accuracyCircle.setRadius(accuracy);
        } else {
          accuracyCircle = L.circle([pos.lat, pos.lng], {
            radius: accuracy,
            color: '#c8ff00',
            weight: 1,
            opacity: 0.5,
            fillColor: '#c8ff00',
            fillOpacity: 0.08,
          }).addTo(m);
        }
      }
    })();
  });
</script>
