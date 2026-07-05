/**
 * Rank the body parts a workout hits, weighted by set count, so displays can
 * show the N most prominent ones.
 */
import type { BodyPart, Exercise } from '../db/types';

export function topBodyParts(
  entries: { exercise: Exercise | undefined; weight?: number }[],
  n = 3
): BodyPart[] {
  const score = new Map<BodyPart, number>();
  for (const { exercise, weight = 1 } of entries) {
    if (!exercise) continue;
    for (const part of exercise.body_parts) {
      score.set(part, (score.get(part) ?? 0) + weight);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([part]) => part);
}
