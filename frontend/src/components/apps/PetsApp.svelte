<script lang="ts">
  import { onMount } from 'svelte';
  import { all } from '../../lib/db/repo';
  import { getProfile } from '../../lib/db/profile';
  import {
    allPets,
    eggsAvailable,
    eggProgress,
    enablePets,
    hatchEgg,
    petActiveMs,
    petAgeMs,
    petsEnabled,
    petsStarted,
    petStageTimeline,
    petTopBodyParts,
    renamePet,
    setActivePet,
    setAllowDuplicates,
    unownedSpecies,
    type StageReached,
  } from '../../lib/pets/xp';
  import { nextThreshold, stageForXp, STAGE_LABELS, STAGE_THRESHOLDS } from '../../lib/pets/config';
  import { randomName } from '../../lib/pets/names';
  import {
    SPRITES,
    EGG_SPRITE,
    EGG_PALETTE,
    PET_STAGES,
    type PetSpecies,
    type PetStage,
  } from '../../lib/pets/sprites';
  import { href } from '../../lib/paths';
  import type { BodyPart, Pet, UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import PixelSprite from '../PixelSprite.svelte';

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let pets: Pet[] = $state([]);
  let eggs = $state(0);
  let progress = $state({ done: 0, needed: 5 });
  let remainingSpecies = $state(0);
  let allowDuplicates = $state(false);
  let busy = $state(false);

  // Hatch reveal: the freshly hatched pet, shown with a name editor.
  let justHatched: Pet | null = $state(null);
  let hatchName = $state('');
  let cracking = $state(false);

  // Inline rename on a collection card.
  let renamingId: string | null = $state(null);
  let renameValue = $state('');

  // Per-pet overview modal (improvements.md task 1).
  let detailPet: Pet | null = $state(null);
  let detailStages: StageReached[] = $state([]);
  let detailActiveMs = $state(0);
  let detailBodyParts: { part: BodyPart; count: number }[] = $state([]);
  let detailStageView: PetStage = $state('baby');

  // Dev sprite sheet (?sheet=1).
  let showSheet = $state(false);

  onMount(async () => {
    showSheet = new URLSearchParams(location.search).get('sheet') === '1';
    await refresh();
    loading = false;
  });

  async function refresh() {
    profile = (await getProfile());
    pets = await allPets();
    eggs = await eggsAvailable();
    progress = await eggProgress();
    remainingSpecies = (await unownedSpecies(pets)).length;
    allowDuplicates = profile?.pets_allow_duplicates ?? false;
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
    if (detailPet?.id === pet.id) detailPet = pets.find((p) => p.id === pet.id) ?? detailPet;
  }

  async function toggleDuplicates(value: boolean) {
    allowDuplicates = value;
    await setAllowDuplicates(value);
    await refresh();
  }

  // ── Per-pet overview modal ──────────────────────────────────────────────
  async function openDetail(pet: Pet) {
    detailPet = pet;
    detailStageView = stageForXp(pet.xp);
    [detailStages, detailActiveMs, detailBodyParts] = await Promise.all([
      petStageTimeline(pet),
      petActiveMs(pet.id),
      petTopBodyParts(pet.id),
    ]);
  }

  function closeDetail() {
    detailPet = null;
  }

  const BODY_PART_LABEL = (bp: BodyPart): string =>
    bp.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /** Coarse, human duration: up to two units (e.g. "4 months, 6 days"). */
  function humanizeDuration(ms: number): string {
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'less than a minute';
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    const unit = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;
    if (years >= 1) {
      const rem = Math.floor((days - years * 365) / 30);
      return rem ? `${unit(years, 'year')}, ${unit(rem, 'month')}` : unit(years, 'year');
    }
    if (months >= 1) {
      const rem = days - months * 30;
      return rem ? `${unit(months, 'month')}, ${unit(rem, 'day')}` : unit(months, 'month');
    }
    if (days >= 1) return unit(days, 'day');
    if (hours >= 1) return unit(hours, 'hour');
    return unit(mins, 'minute');
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

    {#if detailPet}
      {@const pet = detailPet}
      {@const set = SPRITES[pet.species as PetSpecies]}
      {@const curStage = stageForXp(pet.xp)}
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div class="modal detail-modal">
          <button class="close-x" onclick={closeDetail} aria-label="Close">×</button>
          <h3 id="detail-title">{pet.name}</h3>
          <span class="muted">{STAGE_LABELS[curStage]} {pet.species}</span>

          {#if set}
            <div class="detail-focus">
              <PixelSprite
                grid={set.stages[detailStageView]}
                palette={set.palette}
                size={140}
                title={`${pet.name} (${detailStageView})`}
                animation="idle"
              />
            </div>

            <!-- Evolution history — tap a reached form to view it. -->
            <div class="stage-row">
              {#each detailStages as st (st.stage)}
                {@const reached = st.reachedAt != null}
                <button
                  class="stage-cell"
                  class:selected={detailStageView === st.stage}
                  class:locked={!reached}
                  disabled={!reached}
                  onclick={() => (detailStageView = st.stage)}
                >
                  <div class="stage-thumb">
                    <PixelSprite grid={set.stages[st.stage]} palette={set.palette} size={48} title={st.stage} animation={reached?"idle" as any: ""} />
                  </div>
                  <span class="stage-name">{STAGE_LABELS[st.stage]}</span>
                  <span class="stage-when muted">
                    {reached ? formatDate(st.reachedAt!) : '🔒 locked'}
                  </span>
                </button>
              {/each}
            </div>
          {/if}

          <dl class="detail-stats">
            <div><dt>Age</dt><dd>{humanizeDuration(petAgeMs(pet))}</dd></div>
            <div><dt>Time active</dt><dd>{humanizeDuration(detailActiveMs)}</dd></div>
            <div><dt>Lifetime XP</dt><dd>{pet.xp} XP</dd></div>
          </dl>

          {#if detailBodyParts.length > 0}
            <div class="trains">
              <span class="muted">Mostly trains</span>
              <div class="chips">
                {#each detailBodyParts as bp (bp.part)}
                  <span class="chip">{BODY_PART_LABEL(bp.part)}</span>
                {/each}
              </div>
            </div>
          {:else}
            <p class="muted">Train with this pet active to see which muscles it works.</p>
          {/if}

          <div class="modal-actions">
            {#if profile?.active_pet_id === pet.id}
              <span class="active-badge">Active — gaining XP</span>
            {:else}
              <button class="btn btn-primary" onclick={() => makeActive(pet)}>Make active</button>
            {/if}
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
        <label class="dup-toggle">
          <input
            type="checkbox"
            checked={allowDuplicates || collectionComplete}
            disabled={collectionComplete || busy}
            onchange={(e) => toggleDuplicates(e.currentTarget.checked)}
          />
          Allow duplicate species
        </label>
        <p class="muted dup-note">
          {#if collectionComplete}
            You own every species — new eggs now hatch duplicates.
          {:else}
            Off by default: eggs hatch a species you don't own yet.
          {/if}
        </p>
      </Card>
    {/if}

    {#if enabled}
      {#if collectionComplete}
        <p class="notice">All 14 species collected 🏆 — eggs now hatch duplicates.</p>
      {/if}
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
              <button
                class="pet-sprite"
                onclick={() => openDetail(pet)}
                title={`View ${pet.name}'s forms and history`}
                aria-label={`View ${pet.name}'s forms and history`}
              >
                <PixelSprite grid={sprite.grid} palette={sprite.palette} size={88} title={`${pet.name} the ${pet.species}`}
                animation="idle"/>
              </button>
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
    background: none;
    border: none;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .pet-sprite:hover {
    background: var(--color-primary-soft);
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

  .dup-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
    cursor: pointer;
  }

  .dup-note {
    font-size: var(--font-size-sm);
    margin-top: var(--space-1);
  }

  /* ── Per-pet detail modal ── */
  .detail-modal {
    text-align: center;
    position: relative;
    max-width: 30rem;
  }

  .close-x {
    position: absolute;
    top: var(--space-2);
    right: var(--space-3);
    background: none;
    border: none;
    font-size: 1.6rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-muted-color, var(--text-color));
  }

  .detail-focus {
    display: flex;
    justify-content: center;
    padding: var(--space-2);
    image-rendering: pixelated;
  }

  .stage-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }

  .stage-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-1);
    cursor: pointer;
  }

  .stage-cell:not(:disabled):hover {
    background: var(--color-primary-soft);
  }

  .stage-cell.selected {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .stage-cell.locked {
    cursor: default;
    opacity: 0.5;
    filter: grayscale(1);
  }

  .stage-cell.locked .stage-thumb{
    filter: brightness(0.1);

  }

  .stage-thumb {
    image-rendering: pixelated;
  }

  .stage-name {
    font-size: var(--font-size-sm);
    font-weight: 700;
  }

  .stage-when {
    font-size: var(--font-size-xs, 0.72rem);
  }

  .detail-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin: 0;
    text-align: center;
  }

  .detail-stats dt {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color, var(--text-color));
  }

  .detail-stats dd {
    margin: 0;
    font-weight: 700;
  }

  .trains {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: center;
  }

  .chip {
    font-size: var(--font-size-sm);
    font-weight: 700;
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
  }
</style>
