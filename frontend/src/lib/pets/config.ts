/**
 * Pet game balance — every tunable number in one place (pets.md §6).
 * Target: fully evolve one animal in ~50 achievements or ~20 workouts.
 */
import type { PetStage } from './sprites/types';

/** XP a completed workout pays (flat — submit-without-stats included). */
export const WORKOUT_XP = 40;

/** One egg per this many workout XP events (ledger rows, so post-opt-in). */
export const EGG_EVERY_N_WORKOUTS = 5;

/** Retroactive XP credit cap at first opt-in: one free full evolution. */
export const OPTIN_XP_CAP = 1000;

/**
 * Evolution thresholds by lifetime XP, ascending. Escalating gaps
 * (250/300/450) make the last stage feel earned.
 */
export const STAGE_THRESHOLDS: { stage: PetStage; xp: number }[] = [
  { stage: 'baby', xp: 0 },
  { stage: 'juvenile', xp: 250 },
  { stage: 'adult', xp: 550 },
  { stage: 'jacked', xp: 1000 },
];

/** Current evolution stage for a lifetime XP total. Pure derivation. */
export function stageForXp(xp: number): PetStage {
  let stage: PetStage = 'baby';
  for (const t of STAGE_THRESHOLDS) {
    if (xp >= t.xp) stage = t.stage;
  }
  return stage;
}

/** Next threshold above `xp`, or null when fully evolved. */
export function nextThreshold(xp: number): { stage: PetStage; xp: number } | null {
  return STAGE_THRESHOLDS.find((t) => xp < t.xp) ?? null;
}

export const STAGE_LABELS: Record<PetStage, string> = {
  baby: 'Baby',
  juvenile: 'Juvenile',
  adult: 'Adult',
  jacked: 'Jacked',
};
