/**
 * Pet game core: the XP ledger, granting, eggs, hatching, and the
 * opt-in / disable / re-enable lifecycle (pets.md).
 *
 * Idempotency: every XP-worthy event is one `pet_xp_events` row, unique on
 * (source_type, source_key) — re-evaluation, sync replays, and imports can
 * never double-pay. Eggs are DERIVED (1 opt-in egg + one per
 * EGG_EVERY_N_WORKOUTS workout ledger rows, minus pets hatched), so there
 * is no counter to drift. Cross-device races on the denormalized totals
 * are deliberately accepted (see pets.md "Resolved decisions").
 */
import { all, byIndex, get, put, withSyncFields, nowIso } from '../db/repo';
import type {
  AchievementAward,
  BodyPart,
  Exercise,
  Pet,
  PetActiveSpan,
  PetXpEvent,
  PetXpSource,
  UserProfile,
  WorkoutExercise,
} from '../db/types';
import { xpForAward } from '../achievements/catalogue';
import { EGG_EVERY_N_WORKOUTS, OPTIN_XP_CAP, STAGE_THRESHOLDS, stageForXp } from './config';
import { PET_SPECIES, type PetSpecies, type PetStage } from './sprites/types';

export interface XpEventInput {
  source_type: PetXpSource;
  source_key: string;
  xp: number;
}

export interface GrantResult {
  /** Total XP of events that were actually new (0 = everything deduped). */
  granted: number;
  /** Portion paid to the active pet vs banked. */
  toPet: number;
  banked: number;
  /** The recipient pet after the update, if any. */
  pet: Pet | null;
  stageBefore: PetStage | null;
  stageAfter: PetStage | null;
  evolved: boolean;
  /** True when this grant's workout events crossed an egg boundary. */
  eggEarned: boolean;
}

async function profileRow(): Promise<UserProfile | undefined> {
  return (await all<UserProfile>('user_profile'))[0];
}

export const petsStarted = (p: UserProfile | undefined): boolean =>
  (p?.pets_started_at ?? null) != null;
export const petsEnabled = (p: UserProfile | undefined): boolean =>
  petsStarted(p) && (p?.pets_enabled ?? false);

/** All living pets (tombstones filtered by repo). */
export async function allPets(): Promise<Pet[]> {
  return (await all<Pet>('pets')).sort((a, b) => a.hatched_at.localeCompare(b.hatched_at));
}

/** Species not owned yet — the default (no-duplicate) hatch pool (pets.md). */
export async function unownedSpecies(pets?: Pet[]): Promise<PetSpecies[]> {
  const owned = new Set((pets ?? (await allPets())).map((p) => p.species));
  return PET_SPECIES.filter((s) => !owned.has(s));
}

/** True once every species is owned (forces duplicates on, eggs keep flowing). */
export async function allSpeciesOwned(pets?: Pet[]): Promise<boolean> {
  return (await unownedSpecies(pets)).length === 0;
}

/**
 * Whether a hatch may draw an already-owned species. The user's preference
 * (`pets_allow_duplicates`, default off), OR forced on when the collection is
 * complete — otherwise there would be nothing left to hatch (improvements.md
 * task 1.3.2).
 */
function duplicatesEffective(profile: UserProfile | undefined, unownedCount: number): boolean {
  return (profile?.pets_allow_duplicates ?? false) || unownedCount === 0;
}

async function workoutEventCount(): Promise<number> {
  return (await all<PetXpEvent>('pet_xp_events')).filter((e) => e.source_type === 'workout')
    .length;
}

/**
 * Eggs waiting to hatch, derived: 1 (opt-in) + one per EGG_EVERY_N_WORKOUTS
 * post-opt-in workouts, minus pets already hatched. With duplicates off and
 * a complete collection the surplus is capped to the remaining species (0
 * when none remain); with duplicates on, eggs keep flowing indefinitely.
 */
export async function eggsAvailable(): Promise<number> {
  const profile = await profileRow();
  if (!petsStarted(profile)) return 0;
  const pets = await allPets();
  const unowned = await unownedSpecies(pets);
  const earned = 1 + Math.floor((await workoutEventCount()) / EGG_EVERY_N_WORKOUTS);
  const surplus = Math.max(0, earned - pets.length);
  return duplicatesEffective(profile, unowned.length) ? surplus : Math.min(surplus, unowned.length);
}

/** Workouts logged toward the next egg (for "3 / 5" progress UI). */
export async function eggProgress(): Promise<{ done: number; needed: number }> {
  return {
    done: (await workoutEventCount()) % EGG_EVERY_N_WORKOUTS,
    needed: EGG_EVERY_N_WORKOUTS,
  };
}

/**
 * Grant XP for events not seen before. No-ops entirely (returns null) when
 * the user never opted in — the ledger only exists post-opt-in. While
 * disabled (or with no active pet) new XP lands in the bank.
 */
export async function grantXp(events: XpEventInput[]): Promise<GrantResult | null> {
  const profile = await profileRow();
  if (!profile || !petsStarted(profile)) return null;

  const eggsBefore = Math.floor((await workoutEventCount()) / EGG_EVERY_N_WORKOUTS);

  // Dedupe against the ledger via the source_key index.
  const fresh: XpEventInput[] = [];
  for (const ev of events) {
    const existing = await byIndex<PetXpEvent>('pet_xp_events', 'source_key', ev.source_key);
    if (existing.some((e) => e.source_type === ev.source_type)) continue;
    fresh.push(ev);
  }
  if (fresh.length === 0) {
    return {
      granted: 0, toPet: 0, banked: 0, pet: null,
      stageBefore: null, stageAfter: null, evolved: false, eggEarned: false,
    };
  }

  const enabled = petsEnabled(profile);
  const activePet = enabled && profile.active_pet_id
    ? await get<Pet>('pets', profile.active_pet_id)
    : undefined;
  const targetPetId = activePet?.id ?? null;

  let granted = 0;
  const now = nowIso();
  for (const ev of fresh) {
    await put(
      'pet_xp_events',
      withSyncFields({
        source_type: ev.source_type,
        source_key: ev.source_key,
        pet_id: targetPetId,
        xp: ev.xp,
        created_at: now,
      })
    );
    granted += ev.xp;
  }

  let stageBefore: PetStage | null = null;
  let stageAfter: PetStage | null = null;
  let updatedPet: Pet | null = null;
  if (activePet && granted > 0) {
    stageBefore = stageForXp(activePet.xp);
    updatedPet = (await put('pets', { ...activePet, xp: activePet.xp + granted })) as Pet;
    stageAfter = stageForXp(updatedPet.xp);
  } else if (granted > 0) {
    await put('user_profile', {
      ...profile,
      pets_banked_xp: (profile.pets_banked_xp ?? 0) + granted,
    });
  }

  const eggsAfter = Math.floor((await workoutEventCount()) / EGG_EVERY_N_WORKOUTS);
  return {
    granted,
    toPet: updatedPet ? granted : 0,
    banked: updatedPet ? 0 : granted,
    pet: updatedPet,
    stageBefore,
    stageAfter,
    evolved: stageBefore != null && stageAfter != null && stageBefore !== stageAfter,
    eggEarned: eggsAfter > eggsBefore,
  };
}

/**
 * Hatch one egg into a random species with a generated name (the player names
 * it after the reveal — renamePet below). Draws an unowned species by default;
 * once the user allows duplicates (or owns everything) the pool is every
 * species, so owned ones can recur. The first-ever pet becomes active and
 * scoops up any banked XP (that's how the opt-in credit "maxes the first pet
 * immediately" for veterans, pets.md §1).
 */
export async function hatchEgg(): Promise<Pet | null> {
  if ((await eggsAvailable()) < 1) return null;
  const profile = await profileRow();
  if (!profile) return null;
  const pets = await allPets();
  const unowned = await unownedSpecies(pets);
  const pool: readonly PetSpecies[] = duplicatesEffective(profile, unowned.length)
    ? PET_SPECIES
    : unowned;
  if (pool.length === 0) return null;
  const species = pool[Math.floor(Math.random() * pool.length)];
  const { randomName } = await import('./names');

  let pet = (await put(
    'pets',
    withSyncFields({ species, name: randomName(species), xp: 0, hatched_at: nowIso() })
  )) as Pet;

  const isFirst = pets.length === 0;
  const bank = profile.pets_banked_xp ?? 0;
  if (isFirst && bank > 0) {
    await put(
      'pet_xp_events',
      withSyncFields({
        source_type: 'bank_spend' as const,
        source_key: `first-hatch:${pet.id}`,
        pet_id: pet.id,
        xp: bank,
        created_at: nowIso(),
      })
    );
    pet = (await put('pets', { ...pet, xp: pet.xp + bank })) as Pet;
  }

  await put('user_profile', {
    ...profile,
    ...(isFirst && bank > 0 ? { pets_banked_xp: 0 } : {}),
    ...(profile.active_pet_id ? {} : { active_pet_id: pet.id }),
  });
  await reconcileActiveSpan();
  return pet;
}

export async function setActivePet(petId: string): Promise<void> {
  const profile = await profileRow();
  if (!profile) return;
  await put('user_profile', { ...profile, active_pet_id: petId });
  await reconcileActiveSpan();
}

/** Persist the "allow duplicate species" preference (improvements.md 1.3.2). */
export async function setAllowDuplicates(value: boolean): Promise<void> {
  const profile = await profileRow();
  if (!profile) return;
  await put('user_profile', { ...profile, pets_allow_duplicates: value });
}

// ── Active-pet history ───────────────────────────────────────────────────
// One pet_active_spans row per stretch a pet was the active pet while the
// game was enabled (ended_at null = current). Cumulative active time and the
// "when did each stage happen" indicators on the overview are derived from
// these plus the XP ledger — nothing extra is stored.

/** The currently-open spans (should be at most one; sync races may add more). */
async function openActiveSpans(): Promise<PetActiveSpan[]> {
  return (await all<PetActiveSpan>('pet_active_spans')).filter((s) => s.ended_at == null);
}

/**
 * Enforce the invariant: exactly one open span for the active pet iff the game
 * is enabled with an active pet; otherwise none. Idempotent and self-healing —
 * closes strays (including duplicate opens from cross-device races) and opens
 * one if missing. Called after every activate / hatch / enable / disable.
 */
async function reconcileActiveSpan(): Promise<void> {
  const profile = await profileRow();
  const target = petsEnabled(profile) ? (profile?.active_pet_id ?? null) : null;
  const now = nowIso();
  let kept = false;
  for (const span of await openActiveSpans()) {
    if (span.pet_id === target && !kept) {
      kept = true; // keep exactly one open span for the target
    } else {
      await put('pet_active_spans', { ...span, ended_at: now });
    }
  }
  if (target && !kept) {
    await put(
      'pet_active_spans',
      withSyncFields({ pet_id: target, started_at: now, ended_at: null })
    );
  }
}

/** Total ms a pet has spent as the active pet, summed across all its spans. */
export async function petActiveMs(petId: string, now = Date.now()): Promise<number> {
  const spans = await byIndex<PetActiveSpan>('pet_active_spans', 'pet_id', petId);
  return spans.reduce((ms, s) => {
    const end = s.ended_at ? Date.parse(s.ended_at) : now;
    return ms + Math.max(0, end - Date.parse(s.started_at));
  }, 0);
}

/** ms since the pet hatched — its age, independent of time spent active. */
export function petAgeMs(pet: Pet, now = Date.now()): number {
  return Math.max(0, now - Date.parse(pet.hatched_at));
}

export interface StageReached {
  stage: PetStage;
  xp: number;
  /** When the pet first crossed this threshold; null = not yet reached. */
  reachedAt: string | null;
}

/**
 * When this pet entered each evolution stage, reconstructed from its XP ledger
 * (rows sorted by created_at, running total). Baby is "reached" at hatch. Used
 * for the overview's stage indicators (improvements.md task 1.2). The ledger,
 * not the denormalized pet.xp, is authoritative here.
 */
export async function petStageTimeline(pet: Pet): Promise<StageReached[]> {
  const events = (await all<PetXpEvent>('pet_xp_events'))
    .filter((e) => e.pet_id === pet.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const out: StageReached[] = STAGE_THRESHOLDS.map((t) => ({
    stage: t.stage,
    xp: t.xp,
    reachedAt: t.xp === 0 ? pet.hatched_at : null,
  }));

  let cum = 0;
  for (const e of events) {
    const before = cum;
    cum += e.xp;
    for (const s of out) {
      if (s.reachedAt == null && before < s.xp && cum >= s.xp) s.reachedAt = e.created_at;
    }
  }
  return out;
}

/**
 * The pet's most-trained body parts, attributed from the XP it actually earned
 * (improvements.md task 1.4): workout events → the workout's exercises' body
 * parts; exercise-scoped achievement events → that exercise's body parts.
 * Account/program-scoped achievements have no single muscle and are skipped.
 */
export async function petTopBodyParts(
  petId: string,
  topN = 3
): Promise<{ part: BodyPart; count: number }[]> {
  const events = (await all<PetXpEvent>('pet_xp_events')).filter(
    (e) => e.pet_id === petId && e.xp > 0
  );
  if (events.length === 0) return [];

  const [wexAll, exAll] = await Promise.all([
    all<WorkoutExercise>('workout_exercises'),
    all<Exercise>('exercises'),
  ]);
  const exBodyParts = new Map<string, BodyPart[]>(exAll.map((ex) => [ex.id, ex.body_parts]));
  const exByWorkout = new Map<string, string[]>();
  for (const w of wexAll) {
    const arr = exByWorkout.get(w.workout_id) ?? [];
    arr.push(w.exercise_id);
    exByWorkout.set(w.workout_id, arr);
  }

  const tally = new Map<BodyPart, number>();
  const bump = (parts: BodyPart[] | undefined) => {
    for (const p of parts ?? []) tally.set(p, (tally.get(p) ?? 0) + 1);
  };
  for (const e of events) {
    if (e.source_type === 'workout') {
      for (const exId of exByWorkout.get(e.source_key) ?? []) bump(exBodyParts.get(exId));
    } else if (e.source_type === 'achievement') {
      const [, scopeType, scopeId] = e.source_key.split('|');
      if (scopeType === 'exercise' && scopeId) bump(exBodyParts.get(scopeId));
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([part, count]) => ({ part, count }));
}

export async function renamePet(petId: string, name: string): Promise<void> {
  const pet = await get<Pet>('pets', petId);
  if (!pet || !name.trim()) return;
  await put('pets', { ...pet, name: name.trim() });
}

/**
 * First-time opt-in: mark started, enable, and pay the retroactive credit —
 * every existing achievement award is ledgered, XP capped at OPTIN_XP_CAP
 * total (rows beyond the cap carry 0 so they can never pay later). The
 * credit lands in the bank; the first hatch scoops it up.
 * Re-enabling later just flips the toggle — the caller decides what to do
 * with any bank via spendBank()/dumpBank().
 */
export async function enablePets(): Promise<{ firstTime: boolean; bankedXp: number }> {
  const profile = await profileRow();
  if (!profile) return { firstTime: false, bankedXp: 0 };

  if (petsStarted(profile)) {
    await put('user_profile', { ...profile, pets_enabled: true });
    await reconcileActiveSpan();
    return { firstTime: false, bankedXp: profile.pets_banked_xp ?? 0 };
  }

  const now = nowIso();
  let remaining = OPTIN_XP_CAP;
  let credited = 0;
  for (const award of await all<AchievementAward>('achievement_awards')) {
    const key = `${award.achievement}|${award.scope_type}|${award.scope_id}|${award.tier}`;
    const xp = Math.min(xpForAward(award.achievement, award.tier), remaining);
    remaining -= xp;
    credited += xp;
    await put(
      'pet_xp_events',
      withSyncFields({
        source_type: 'achievement' as const,
        source_key: key,
        pet_id: null,
        xp,
        created_at: now,
      })
    );
  }

  await put('user_profile', {
    ...profile,
    pets_enabled: true,
    pets_started_at: now,
    pets_banked_xp: (profile.pets_banked_xp ?? 0) + credited,
  });
  return { firstTime: true, bankedXp: credited };
}

export async function disablePets(): Promise<void> {
  const profile = await profileRow();
  if (!profile) return;
  await put('user_profile', { ...profile, pets_enabled: false });
  await reconcileActiveSpan();
}

/** Re-enable choice: grant the bank to the active pet. */
export async function spendBank(): Promise<void> {
  const profile = await profileRow();
  const bank = profile?.pets_banked_xp ?? 0;
  if (!profile || bank <= 0) return;
  const pet = profile.active_pet_id ? await get<Pet>('pets', profile.active_pet_id) : undefined;
  if (!pet) return; // nothing to spend on — keep the bank
  await put(
    'pet_xp_events',
    withSyncFields({
      source_type: 'bank_spend' as const,
      source_key: `bank-spend:${crypto.randomUUID()}`,
      pet_id: pet.id,
      xp: bank,
      created_at: nowIso(),
    })
  );
  await put('pets', { ...pet, xp: pet.xp + bank });
  await put('user_profile', { ...profile, pets_banked_xp: 0 });
}

/** Re-enable choice: dump the bank and start collecting from now on. */
export async function dumpBank(): Promise<void> {
  const profile = await profileRow();
  if (!profile || (profile.pets_banked_xp ?? 0) === 0) return;
  await put('user_profile', { ...profile, pets_banked_xp: 0 });
}
