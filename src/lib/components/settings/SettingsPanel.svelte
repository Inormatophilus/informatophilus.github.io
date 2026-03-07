<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { a11yStore } from '$lib/stores/a11y.svelte';
  import ProfileTab from './tabs/ProfileTab.svelte';
  import GeneralTab from './tabs/GeneralTab.svelte';
  import TracksTab from './tabs/TracksTab.svelte';
  import BackupTab from './tabs/BackupTab.svelte';
  import MarkersTab from './tabs/MarkersTab.svelte';
  import QRTab from './tabs/QRTab.svelte';
  import AppTab from './tabs/AppTab.svelte';

  const TABS = [
    { id: 'profile',  label: 'Profil',    emoji: '👤' },
    { id: 'general',  label: 'Allgemein', emoji: '⚙' },
    { id: 'tracks',   label: 'Tracks',    emoji: '🗺' },
    { id: 'backup',   label: 'Backup',    emoji: '💾' },
    { id: 'markers',  label: 'Marker',    emoji: '📍' },
    { id: 'qr',       label: 'QR',        emoji: '📷' },
    { id: 'app',      label: 'App',       emoji: '📱' },
  ] as const;

  function switchTab(id: typeof TABS[number]['id']) {
    app.switchTab(id as typeof app.settingsTab);
    a11yStore.speak(id, true);
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div
  class="settings-backdrop {app.settingsOpen ? 'open' : ''}"
  onclick={() => app.closeSettings()}
  role="presentation"
></div>

<!-- Panel -->
<aside class="settings-panel {app.settingsOpen ? 'open' : ''}" aria-label="Einstellungen">
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem;border-bottom:1px solid var(--bd)">
    <span style="font-family:var(--fh);font-size:1.2rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase">
      ⚙ Einstellungen
    </span>
    <button class="btn-icon" onclick={() => app.closeSettings()} aria-label="Schließen">✕</button>
  </div>

  <!-- Tab Navigation -->
  <div class="tabs" style="margin:0.5rem 0.75rem;flex-wrap:wrap;overflow-x:visible;gap:0.3rem">
    {#each TABS as tab}
      <button
        class="tab {app.settingsTab === tab.id ? 'active' : ''}"
        onclick={() => switchTab(tab.id)}
        aria-selected={app.settingsTab === tab.id}
      >
        {tab.emoji} {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div style="flex:1;overflow-y:auto;padding:0 0.75rem calc(1rem + env(safe-area-inset-bottom, 0px))">
    {#if app.settingsTab === 'profile'}
      <ProfileTab />
    {:else if app.settingsTab === 'general'}
      <GeneralTab />
    {:else if app.settingsTab === 'tracks'}
      <TracksTab />
    {:else if app.settingsTab === 'backup'}
      <BackupTab />
    {:else if app.settingsTab === 'markers'}
      <MarkersTab />
    {:else if app.settingsTab === 'qr'}
      <QRTab />
    {:else if app.settingsTab === 'app'}
      <AppTab />
    {/if}
  </div>
</aside>
