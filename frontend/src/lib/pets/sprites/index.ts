/**
 * The full sprite set: 14 species × 4 stages + the shared egg (57 grids).
 * See ./types.ts for the grid format and pets.md §"Pixel art" for the plan.
 */
import type { PetSpecies, SpeciesSpriteSet } from './types';
import { turtle } from './turtle';
import { frog } from './frog';
import { crab } from './crab';
import { lion } from './lion';
import { octopus } from './octopus';
import { pangolin } from './pangolin';
import { dragon } from './dragon';
import { snake } from './snake';
import { parakeet } from './parakeet';
import { monkey } from './monkey';
import { cow } from './cow';
import { minotaur } from './minotaur';
import { hamster } from './hamster';
import { scorpion } from './scorpion';

export * from './types';
export { EGG_SPRITE, EGG_PALETTE } from './egg';

export const SPRITES: Record<PetSpecies, SpeciesSpriteSet> = {
  turtle,
  frog,
  crab,
  lion,
  octopus,
  pangolin,
  dragon,
  snake,
  parakeet,
  monkey,
  cow,
  minotaur,
  hamster,
  scorpion,
};
