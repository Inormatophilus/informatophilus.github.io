<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte';
  import { app } from '$lib/stores/app.svelte';

  let marker:        import('leaflet').Marker | null = null;
  let accuracyCircle: import('leaflet').Circle | null = null;

  function calcSize(zoom: number): number {
    // Larger base so the GPS position is clearly visible at all zoom levels
    return Math.max(40, Math.min(64, 22 + zoom * 1.5));
  }

  $effect(() => {
    // ── Synchronous reactive reads (tracked by Svelte 5) ──────────────────
    const pos           = mapStore.gpsPos;
    const m             = mapStore.map;
    const emoji         = app.gpsEmoji;
    const deviceHeading = mapStore.gpsHeading;
    const moveHeading   = mapStore.gpsMovementHeading;
    const accuracy      = mapStore.gpsAccuracy;

    if (!m) return;

    const heading = deviceHeading ?? moveHeading;

    (async () => {
      const L = await import('leaflet');

      if (!pos) {
        if (marker)        { m.removeLayer(marker);         marker         = null; }
        if (accuracyCircle){ m.removeLayer(accuracyCircle); accuracyCircle = null; }
        return;
      }

      const zoom = m.getZoom();
      const size = calcSize(zoom);
      const half = size / 2;
      const emojiSize = Math.round(size * 0.58);

      // Direction arrow — rotated triangle above the circle
      const arrowHtml = heading !== null
        ? `<div style="position:absolute;inset:0;transform:rotate(${heading}deg);pointer-events:none;z-index:2">` +
          `<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);` +
          `border-left:5px solid transparent;border-right:5px solid transparent;` +
          `border-bottom:11px solid #c8ff00;` +
          `filter:drop-shadow(0 0 3px rgba(0,0,0,0.9))"></div></div>`
        : '';

      // Outer pulsing ring
      const pulseHtml =
        `<div style="position:absolute;inset:-10px;border-radius:50%;` +
        `border:2px solid rgba(200,255,0,0.38);` +
        `animation:gps-pulse 2s ease-out infinite;pointer-events:none"></div>`;

      // Inner solid circle with emoji
      const bodyHtml =
        `<div style="position:absolute;inset:0;border-radius:50%;` +
        `background:rgba(11,14,20,0.82);` +
        `border:2.5px solid #c8ff00;` +
        `box-shadow:0 0 10px rgba(200,255,0,0.55),inset 0 0 4px rgba(200,255,0,0.1);` +
        `display:flex;align-items:center;justify-content:center;z-index:1">` +
        `<span style="font-size:${emojiSize}px;line-height:1">${emoji}</span></div>`;

      const icon = L.divIcon({
        className: 'gps-marker-wrap',
        html:
          `<div style="position:relative;width:${size}px;height:${size}px">` +
          pulseHtml +
          arrowHtml +
          bodyHtml +
          `</div>`,
        iconSize:   [size, size],
        iconAnchor: [half, half],
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
            radius:      accuracy,
            color:       '#c8ff00',
            weight:      1,
            opacity:     0.4,
            fillColor:   '#c8ff00',
            fillOpacity: 0.06,
          }).addTo(m);
        }
      }
    })();
  });
</script>

<!-- Pulse animation injected once into document head -->
<svelte:head>
  <style>
    @keyframes gps-pulse {
      0%   { transform: scale(1);   opacity: 0.8; }
      100% { transform: scale(1.8); opacity: 0;   }
    }
  </style>
</svelte:head>
