<script lang="ts">
  import { onMount } from 'svelte';
  import { all } from '../../lib/db/repo';
  import {
    allPets,
    eggsAvailable,
    eggProgress,
    enablePets,
    hatchEgg,
    petsEnabled,
    petsStarted,
    renamePet,
    setActivePet,
    unownedSpecies,
  } from '../../lib/pets/xp';
  import { nextThreshold, stageForXp, STAGE_LABELS, STAGE_THRESHOLDS } from '../../lib/pets/config';
  import { randomName } from '../../lib/pets/names';
  import { SPRITES, EGG_SPRITE, EGG_PALETTE, PET_STAGES, type PetSpecies } from '../../lib/pets/sprites';
  import { href } from '../../lib/paths';
  import type { Pet, UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import PixelSprite from '../PixelSprite.svelte';

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let pets: Pet[] = $state([]);
  let eggs = $state(0);
  let progress = $state({ done: 0, needed: 5 });
  let remainingSpecies = $state(0);
  let busy = $state(false);

  // Hatch reveal: the freshly hatched pet, shown with a name editor.
  let justHatched: Pet | null = $state(null);
  let hatchName = $state('');
  let cracking = $state(false);

  // Inline rename on a collection card.
  let renamingId: string | null = $state(null);
  let renameValue = $state('');

  // Dev sprite sheet (?sheet=1).
  let showSheet = $state(false);

  onMount(async () => {
    showSheet = new URLSearchParams(location.search).get('sheet') === '1';
    await refresh();
    loading = false;
  });

  async function refresh() {
    profile = (await all<UserProfile>('user_profile'))[0];
    pets = await allPets();
    eggs = await eggsAvailable();
    progress = await eggProgress();
    remainingSpecies = (await unownedSpecies(pets)).length;
  }

  const started = $derived(petsStarted(profile));
  const enabled = $derived(petsEnabled(profile));
  const collectionComplete = $derived(started && remainingSpecies === 0);

  async function optIn() {
    busy = true;
    await enablePets();
    await refresh();
    busy = false;
  }

  async function crackEgg() {
    if (busy) return;
    busy = true;
    cracking = true;
    // Let the wobble animation play before the reveal.
    await new Promise((r) => setTimeout(r, 650));
    const pet = await hatchEgg();
    cracking = false;
    if (pet) {
      justHatched = pet;
      hatchName = pet.name;
    }
    await refresh();
    busy = false;
  }

  async function confirmHatchName() {
    if (!justHatched) return;
    if (hatchName.trim() && hatchName.trim() !== justHatched.name) {
      await renamePet(justHatched.id, hatchName);
    }
    justHatched = null;
    hatchName = '';
    await refresh();
  }

  function rollHatchName() {
    if (justHatched) hatchName = randomName(justHatched.species as PetSpecies);
  }

  async function makeActive(pet: Pet) {
    await setActivePet(pet.id);
    await refresh();
  }

  function startRename(pet: Pet) {
    renamingId = pet.id;
    renameValue = pet.name;
  }

  async function saveRename(pet: Pet) {
    await renamePet(pet.id, renameValue);
    renamingId = null;
    await refresh();
  }

  const spriteFor = (pet: Pet) => {
    const set = SPRITES[pet.species as PetSpecies];
    return set ? { grid: set.stages[stageForXp(pet.xp)], palette: set.palette } : null;
  };

  const xpBar = (pet: Pet) => {
    const next = nextThreshold(pet.xp);
    if (!next) return { pct: 100, text: `${pet.xp} XP — fully evolved` };
    const prev = [...STAGE_THRESHOLDS].reverse().find((t) => t.xp <= pet.xp)!;
    const pct = Math.min(100, ((pet.xp - prev.xp) / (next.xp - prev.xp)) * 100);
    return { pct, text: `${pet.xp} / ${next.xp} XP` };
  };
</script>

{#if loading}
  <p class="muted">Loading…</p>
{:else if showSheet}
  <!-- Dev-only sprite sheet: /pets/?sheet=1 -->
  <div class="stack">
    {#each Object.entries(SPRITES) as [species, set] (species)}
      <Card title={species}>
        <div class="sheet-row">
          {#each PET_STAGES as stage}
            <div class="sheet-cell">
              <PixelSprite grid={set.stages[stage]} palette={set.palette} size={96} title={`${species} ${stage}`} animation="idle"/>
              <span class="muted">{stage}</span>
            </div>
          {/each}
        </div>
      </Card>
    {/each}
    <Card title="egg">
      <PixelSprite grid={EGG_SPRITE} palette={EGG_PALETTE} size={96} title="egg" />
    </Card>
  </div>
{:else if !started}
  <Card title="Hatch a workout buddy 🥚">
    <p style="margin-bottom: var(--space-3);">
      An optional collection game: your training earns XP that grows a
      pixel-art companion from a baby into a jacked beast. You'll get one
      egg now and another every 5 workouts — 14 species to collect.
    </p>
    <p class="muted" style="margin-bottom: var(--space-3);">
      Purely cosmetic, zero effect on your training data, and you can turn
      it off any time in Settings.
    </p>
    <button class="btn btn-primary" onclick={optIn} disabled={busy}>
      {busy ? 'Starting…' : 'Start the pet game'}
    </button>
  </Card>
{:else}
  <div class="stack">
    {#if !enabled}
      <p class="notice">
        The pet game is currently disabled — your collection is safe and
        points are being banked. Re-enable it in
        <a href={href('/settings/')}>Settings</a>.
      </p>
    {/if}

    {#if justHatched}
      {@const set = SPRITES[justHatched.species as PetSpecies]}
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="hatch-title">
        <div class="modal hatch-modal">
          <h3 id="hatch-title">It's a {justHatched.species}!</h3>
          {#if set}
            <div class="hatch-reveal">
              <PixelSprite grid={set.stages[stageForXp(justHatched.xp)]} palette={set.palette} size={128} title={justHatched.species} animation="happy"/>
            </div>
          {/if}
          {#if justHatched.xp > 0}
            <p class="muted">
              Your training history counts — it hatched with
              <strong>{justHatched.xp} XP</strong> ({STAGE_LABELS[stageForXp(justHatched.xp)]})!
            </p>
          {/if}
          <label for="hatch-name">Name your {justHatched.species}</label>
          <div class="name-row">
            <input id="hatch-name" bind:value={hatchName} maxlength="24" />
            <button class="btn" onclick={rollHatchName}>🎲 Roll</button>
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" onclick={confirmHatchName} disabled={!hatchName.trim()}>
              Welcome, {hatchName.trim() || '…'}!
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if enabled && eggs > 0}
      <Card title={eggs === 1 ? 'You have an egg!' : `You have ${eggs} eggs!`}>
        <div class="egg-tray">
          {#each Array(Math.min(eggs, 6)) as _, i (i)}
            <button
              class="egg-btn"
              class:cracking={cracking && i === 0}
              onclick={crackEgg}
              disabled={busy}
              aria-label="Hatch an egg"
            >
              <PixelSprite grid={EGG_SPRITE} palette={EGG_PALETTE} size={72} title="egg" animation="idle"/>
            </button>
          {/each}
        </div>
        <p class="muted" style="margin-top: var(--space-2);">Tap an egg to hatch it.</p>
      </Card>
    {/if}

    {#if collectionComplete}
      <p class="notice">Collection complete 🏆 — all 14 species are yours.</p>
    {:else if enabled}
      <p class="muted">
        {progress.needed - progress.done}
        {progress.needed - progress.done === 1 ? 'workout' : 'workouts'} to your
        next egg 🥚 ({progress.done} / {progress.needed})
      </p>
    {/if}

    {#if pets.length > 0}
      <h2 class="section-title">Your collection</h2>
      <div class="pet-grid">
        {#each pets as pet (pet.id)}
          {@const sprite = spriteFor(pet)}
          {@const bar = xpBar(pet)}
          {@const isActive = profile?.active_pet_id === pet.id}
          <div class="pet-card" class:active={isActive}>
            {#if sprite}
              <div class="pet-sprite">
                <PixelSprite grid={sprite.grid} palette={sprite.palette} size={88} title={`${pet.name} the ${pet.species}`} 
                animation="idle"/>
              </div>
            {/if}
            {#if renamingId === pet.id}
              <div class="name-row">
                <input bind:value={renameValue} maxlength="24" aria-label="Pet name" />
                <button class="btn" onclick={() => saveRename(pet)} disabled={!renameValue.trim()}>Save</button>
              </div>
            {:else}
              <button class="pet-name" title="Rename" onclick={() => startRename(pet)}>
                {pet.name}
              </button>
            {/if}
            <span class="muted pet-meta">
              {STAGE_LABELS[stageForXp(pet.xp)]} {pet.species}
            </span>
            <div class="bar"><div class="fill" style={`width: ${bar.pct}%`}></div></div>
            <span class="muted pet-xp">{bar.text}</span>
            {#if isActive}
              <span class="active-badge">Active — gaining XP</span>
            {:else}
              <button class="btn" onclick={() => makeActive(pet)}>Make active</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .egg-tray {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .egg-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-md);
  }

  .egg-btn:hover {
    background: var(--color-primary-soft);
  }

  .egg-btn.cracking {
    animation: wobble 0.22s ease-in-out infinite;
  }

  @keyframes wobble {
    0%, 100% { transform: rotate(-8deg); }
    50% { transform: rotate(8deg); }
  }

  .hatch-modal {
    text-align: center;
  }

  .hatch-reveal {
    display: flex;
    justify-content: center;
    padding: var(--space-3);
    animation: pop-in 0.35s ease-out;
  }

  @keyframes pop-in {
    from { transform: scale(0.3); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .name-row {
    display: flex;
    gap: var(--space-2);
    justify-content: center;
  }

  .name-row input {
    flex: 1;
    max-width: 16rem;
  }

  .pet-grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  }

  .pet-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    background: var(--surface-color);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }

  .pet-card.active {
    border-color: var(--color-primary);
  }

  .pet-sprite {
    image-rendering: pixelated;
  }

  .pet-name {
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    font-weight: 800;
    color: var(--text-color);
    padding: 0;
  }

  .pet-name:hover {
    color: var(--color-primary-strong);
  }

  .pet-meta,
  .pet-xp {
    font-size: var(--font-size-sm);
  }

  .bar {
    width: 100%;
    height: 0.5rem;
    border-radius: var(--radius-full);
    background: var(--border-color);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary);
  }

  .active-badge {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--color-primary-strong);
    background: var(--color-primary-soft);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
  }

  .sheet-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .sheet-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.5);
    display: grid;
    place-items: center;
    z-index: 50;
    padding: var(--space-4);
  }

  .modal {
    background: var(--surface-raised-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    padding: var(--space-5);
    max-width: 28rem;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .modal-actions {
    display: flex;
    justify-content: center;
  }

  .notice {
    background: var(--color-primary-soft);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }
</style>
