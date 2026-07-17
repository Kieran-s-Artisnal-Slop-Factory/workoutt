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
import type { AchievementAward, Pet, PetXpEvent, PetXpSource, UserProfile } from '../db/types';
import { xpForAward } from '../achievements/catalogue';
import { EGG_EVERY_N_WORKOUTS, OPTIN_XP_CAP, stageForXp } from './config';
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

/** Species not owned yet — hatching never duplicates (pets.md). */
export async function unownedSpecies(pets?: Pet[]): Promise<PetSpecies[]> {
  const owned = new Set((pets ?? (await allPets())).map((p) => p.species));
  return PET_SPECIES.filter((s) => !owned.has(s));
}

async function workoutEventCount(): Promise<number> {
  return (await all<PetXpEvent>('pet_xp_events')).filter((e) => e.source_type === 'workout')
    .length;
}

/**
 * Eggs waiting to hatch, derived: 1 (opt-in) + one per EGG_EVERY_N_WORKOUTS
 * post-opt-in workouts, minus pets already hatched. 0 once the collection
 * is complete (nothing left to hatch).
 */
export async function eggsAvailable(): Promise<number> {
  const profile = await profileRow();
  if (!petsStarted(profile)) return 0;
  const pets = await allPets();
  if ((await unownedSpecies(pets)).length === 0) return 0;
  const earned = 1 + Math.floor((await workoutEventCount()) / EGG_EVERY_N_WORKOUTS);
  return Math.max(0, earned - pets.length);
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
 * Hatch one egg into a random unowned species with a generated name (the
 * player names it after the reveal — renamePet below). The first-ever pet
 * becomes active and scoops up any banked XP (that's how the opt-in credit
 * "maxes the first pet immediately" for veterans, pets.md §1).
 */
export async function hatchEgg(): Promise<Pet | null> {
  if ((await eggsAvailable()) < 1) return null;
  const profile = await profileRow();
  if (!profile) return null;
  const pets = await allPets();
  const pool = await unownedSpecies(pets);
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
  return pet;
}

export async function setActivePet(petId: string): Promise<void> {
  const profile = await profileRow();
  if (!profile) return;
  await put('user_profile', { ...profile, active_pet_id: petId });
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
