/** Generated pet names, a small in-code list per species (pets.md §3). */
import type { PetSpecies } from './sprites/types';

const NAMES: Record<PetSpecies, string[]> = {
  turtle: ['Tank', 'Sheldon', 'Crunch', 'Torque', 'Patience'],
  frog: ['Hops', 'Burpee', 'Ribbit Rousey', 'Springs', 'Kermit the Swole'],
  crab: ['Pinch Press', 'Clawdia', 'Sidestep', 'Krusty', 'Shellby'],
  lion: ['Roary', 'Maximus', 'PR-ide', 'Leo Gains', 'Mufasa Mass'],
  octopus: ['Octavia', 'Grippy', 'Eight-Pack', 'Inky', 'Tentacle Ted'],
  pangolin: ['Rollie', 'Scales', 'Curl', 'Plates', 'Pango'],
  dragon: ['Deadlift Dave', 'Smaug Squat', 'Ember', 'Wyrmup', 'Scorch'],
  snake: ['Coil', 'Hisspanic Thunder', 'Noodle', 'Slither Splits', 'Fang'],
  parakeet: ['Chirp', 'Wingspan', 'Tweety Gains', 'Flaps', 'Kiwi'],
  monkey: ['Chalk', 'Kipping Kong', 'Banana Split', 'Swinger', 'Bars'],
  cow: ['Mooscles', 'Bulk', 'Bessie Press', 'Creatine', 'Heifer Lifter'],
  minotaur: ['Mazerunner', 'Horns', 'Taurus', 'Labyrinth Larry', 'Bullwork'],
  hamster: ['Wheelie', 'Cardio', 'Cheeks', 'Nibbles', 'Turbo'],
  scorpion: ['Sting', 'Tailwhip', 'Pincer', 'Venom Vinny', 'Stretch'],
};

export function randomName(species: PetSpecies): string {
  const pool = NAMES[species];
  return pool[Math.floor(Math.random() * pool.length)];
}
