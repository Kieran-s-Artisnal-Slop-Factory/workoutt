/**
 * Pixel-art sprite format for the pet collection game (see pets.md §"Pixel
 * art"). Each sprite is a small grid of palette indexes stored as strings —
 * no binary assets, diffs stay reviewable, and a renderer emits one SVG
 * <rect> per pixel with `shape-rendering: crispEdges`.
 *
 * Grid characters:
 *   '.'        transparent
 *   '1'..'4'   species palette: 1 outline, 2 primary, 3 secondary, 4 accent
 *   'w' 'k'    shared: white (eye shine), near-black (detail)
 *   'g' 'd'    shared: steel + dark steel (the jacked stage's dumbbell)
 */

export const PET_SPECIES = [
  'turtle',
  'frog',
  'crab',
  'lion',
  'octopus',
  'pangolin',
  'dragon',
  'snake',
  'parakeet',
  'monkey',
  'cow',
  'minotaur',
  'hamster',
  'scorpion',
] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PET_STAGES = ['baby', 'juvenile', 'adult', 'jacked'] as const;
export type PetStage = (typeof PET_STAGES)[number];

/** Grid edge length per stage — the silhouette literally grows. */
export const STAGE_SIZES: Record<PetStage, number> = {
  baby: 16,
  juvenile: 18,
  adult: 20,
  jacked: 24,
};

export interface SpriteGrid {
  /** Edge length; `rows` is exactly `size` strings of `size` chars. */
  size: number;
  rows: string[];
}

export interface SpeciesSpriteSet {
  /** [outline, primary, secondary, accent] as CSS colors. */
  palette: [string, string, string, string];
  stages: Record<PetStage, SpriteGrid>;
}

/** Colors shared by every species (indexes 'w', 'k', 'g', 'd'). */
export const SHARED_COLORS: Record<string, string> = {
  w: '#ffffff',
  k: '#1d1d24',
  g: '#9aa1ad',
  d: '#4b4f58',
};

/** CSS color for one grid char, or null for transparent ('.'). */
export function resolveColor(
  char: string,
  palette: readonly [string, string, string, string],
): string | null {
  if (char === '.') return null;
  if (char >= '1' && char <= '4') return palette[char.charCodeAt(0) - 49];
  return SHARED_COLORS[char] ?? null;
}
