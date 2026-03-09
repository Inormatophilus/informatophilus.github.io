<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { a11yStore } from '$lib/stores/a11y.svelte';
  import { mapStore } from '$lib/stores/map.svelte';
  import { projectsStore } from '$lib/stores/projects.svelte';
  import { saveGpsEmoji } from '$lib/services/storage';

  const GPS_EMOJIS = ['🦄','🏔','🚵','⛰','🌲','🦊','🔥','⭐','💎','🎯','🗿','🌊','🌀','🐺','🦅','🏆'];

  function setGpsEmoji(em: string) {
    app.setGpsEmoji(em);
  }
</script>

<div style="padding-top:0.75rem;display:flex;flex-direction:column;gap:1rem">

  <!-- Theme -->
  <div class="card card-sm">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span class="form-label">{app.t('theme')}</span>
      <button class="btn btn-secondary btn-sm" onclick={() => app.toggleTheme()}>
        {app.isDark ? '☀️ Hell' : '🌙 Dunkel'}
      </button>
    </div>
  </div>

  <!-- GPS Emoji -->
  <div class="card card-sm">
    <div class="form-label mb-2">{app.t('gps_emoji')}</div>
    <div class="emoji-grid">
      {#each GPS_EMOJIS as em}
        <button
          class="emoji-option {app.gpsEmoji === em ? 'selected' : ''}"
          onclick={() => setGpsEmoji(em)}
        >{em}</button>
      {/each}
    </div>
  </div>

  <!-- Home Region -->
  <div class="card card-sm">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div>
        <div class="form-label">{app.t('home_region')}</div>
        <div class="text-sm text-dim">Karte startet hier</div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick={() => mapStore.setHomeRegion()}>
        📌 {app.t('save_view')}
      </button>
    </div>
  </div>

  <!-- Projekt Übersicht -->
  <div class="card">
    <div class="form-label mb-2">Projekte</div>
    {#each projectsStore.projects as proj}
      <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--bd)">
        <span style="width:8px;height:8px;border-radius:50%;background:{proj.enabled !== false ? 'var(--ac)' : 'var(--td)'}"></span>
        <span style="flex:1;font-size:0.9rem" class="truncate">{proj.name}</span>
        <label class="toggle" title="Sichtbar">
          <input type="checkbox" checked={proj.enabled !== false}
            onchange={(e) => projectsStore.toggleEnabled(proj.id, (e.target as HTMLInputElement).checked)} />
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-icon btn-sm" style="font-size:0.8rem"
          onclick={() => projectsStore.setFocus(proj.id)}
          title="Fokus setzen"
        >⭐</button>
        <button class="btn-icon btn-sm" style="font-size:0.8rem"
          onclick={() => projectsStore.exportProject(proj.id)}
          title="Exportieren"
        >📤</button>
        <button class="btn-icon btn-sm" style="font-size:0.8rem;color:#ef4444"
          onclick={() => { if (confirm(`Projekt "${proj.name}" löschen?`)) projectsStore.deleteProject(proj.id); }}
          title="Löschen"
        >🗑</button>
      </div>
    {/each}
    <button class="btn btn-secondary btn-sm w-full mt-2"
      onclick={() => { app.closeSettings(); projectsStore.startCreateMode(); }}>
      + Neues Projekt
    </button>
  </div>

  <!-- TTS / A11Y -->
  <div class="card">
    <div class="form-label mb-2">{app.t('a11y')}</div>
    <div style="display:flex;flex-direction:column;gap:0.6rem">

      <div style="display:flex;align-items:center;justify-content:space-between">
        <span class="text-sm">{app.t('tts_enabled')}</span>
        <label class="toggle">
          <input type="checkbox" bind:checked={a11yStore.enabled}
            onchange={() => a11yStore.toggle()} />
          <span class="toggle-slider"></span>
        </label>
      </div>

      {#if a11yStore.enabled}
        <div>
          <label class="form-label" for="tts-rate">{app.t('tts_rate')}: {a11yStore.rate.toFixed(1)}x</label>
          <input id="tts-rate" type="range" min="0.5" max="2" step="0.1"
            value={a11yStore.rate}
            oninput={(e) => a11yStore.setRate(parseFloat((e.target as HTMLInputElement).value))} />
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="text-sm">{app.t('high_contrast')}</span>
          <label class="toggle">
            <input type="checkbox" bind:checked={a11yStore.hc}
              onchange={() => a11yStore.toggleHc()} />
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div style="display:flex;gap:0.4rem">
          <button class="btn btn-secondary btn-sm flex-1"
            onclick={() => a11yStore.speakMapOverview()}>{app.t('map_overview')}</button>
          <button class="btn btn-secondary btn-sm flex-1"
            onclick={() => a11yStore.speakNearestPoint()}>{app.t('nearest_point')}</button>
        </div>
      {/if}
    </div>
  </div>

</div>
