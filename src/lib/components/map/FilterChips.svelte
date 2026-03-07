<script lang="ts">
  import { mapStore, type MapFilter } from '$lib/stores/map.svelte';
  import { projectsStore } from '$lib/stores/projects.svelte';
  import ProjectDropdown from '$lib/components/projects/ProjectDropdown.svelte';

  const filters: { id: MapFilter; label: string; icon: string }[] = [
    { id: 'all',               label: 'Alle',     icon: ''   },
    { id: 'beginner',          label: 'Beginner', icon: '🟢' },
    { id: 'mittel',            label: 'Mittel',   icon: '🟡' },
    { id: 'expert',            label: 'Expert',   icon: '🔴' },
    { id: 'optional-logistik', label: 'Logistik', icon: '🔵' },
  ];

  let projOpen = $state(false);

  const activeProject = $derived(
    projectsStore.projects.find(p => p.id === projectsStore.activeProjectId)
  );
</script>

<div class="cat-filter-row">
  {#each filters as f}
    <button
      class="cat-fbtn {mapStore.filter === f.id ? 'on' : ''}"
      onclick={() => mapStore.setFilter(f.id)}
      aria-pressed={mapStore.filter === f.id}
      data-c={f.id}
    >
      {#if f.icon}<span class="chip-icon">{f.icon}</span>{/if}{f.label}
    </button>
  {/each}

  <!-- Project picker -->
  <div class="proj-bar">
    <button
      class="proj-toggle-btn"
      onclick={() => projOpen = !projOpen}
      aria-haspopup="listbox"
      aria-expanded={projOpen}
      aria-label="Aktives Projekt wechseln"
    >
      <span class="proj-curr-name">{activeProject?.name ?? 'Projekt'}</span>
      <svg
        width="10" height="6" viewBox="0 0 10 6" fill="none"
        style="flex-shrink:0;transition:transform 0.2s;transform:{projOpen ? 'rotate(180deg)' : 'none'}"
      >
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    {#if projOpen}
      <ProjectDropdown onselect={() => projOpen = false} />
    {/if}
  </div>
</div>

<!-- Backdrop to close project dropdown -->
{#if projOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="proj-backdrop"
    onclick={() => projOpen = false}
    role="presentation"
  ></div>
{/if}

<style>
  .cat-filter-row {
    position: absolute;
    top: 58px;
    left: 0; right: 0;
    z-index: var(--z-fab);
    display: flex;
    gap: 6px;
    padding: 6px 12px 8px;
    overflow-x: auto;
    scrollbar-width: none;
    pointer-events: none;
    align-items: center;
  }
  .cat-filter-row::-webkit-scrollbar { display: none; }
  .cat-fbtn, .proj-bar { pointer-events: auto; }

  .cat-fbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid var(--bd2);
    font-family: var(--fh);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    background: var(--s2);
    color: var(--td);
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .cat-fbtn:active { transform: scale(0.93); }
  .cat-fbtn.on { border-color: transparent; color: #000; background: var(--tx); }
  .cat-fbtn[data-c="beginner"].on  { background: #27AE60; color: #fff; }
  .cat-fbtn[data-c="mittel"].on    { background: #D4A017; color: #000; }
  .cat-fbtn[data-c="expert"].on    { background: #ef4444; color: #fff; }
  .cat-fbtn[data-c="optional-logistik"].on { background: #38bdf8; color: #000; }

  .chip-icon { font-size: 10px; line-height: 1; }

  /* ── Project dropdown ───────────────────────────────────────── */
  .proj-bar {
    position: relative;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .proj-toggle-btn {
    background: var(--s2);
    border: 1.5px solid var(--bd2);
    border-radius: 10px;
    padding: 5px 10px 5px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-family: var(--fh);
    font-size: 12px;
    font-weight: 700;
    color: var(--tx);
    max-width: 150px;
    min-width: 70px;
    transition: border-color 0.15s, background 0.15s;
  }
  .proj-toggle-btn:hover { background: var(--s3); border-color: var(--ac); }
  .proj-toggle-btn[aria-expanded="true"] { border-color: var(--ac); background: var(--s3); }

  .proj-curr-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .proj-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-fab) - 1);
  }
</style>
