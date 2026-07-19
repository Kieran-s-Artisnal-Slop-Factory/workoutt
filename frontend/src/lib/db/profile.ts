/**
 * The user profile is a SINGLETON. It lives under one fixed row id so that
 * every device converges on the same record instead of each onboarding
 * minting a fresh UUID — which produced duplicate profiles that didn't
 * merge on sync (one device's settings silently shadowing another's).
 *
 * `getProfile()` is the single read path: it heals any pre-existing
 * duplicate rows (from before this fix, or pulled from a server that still
 * has them) by collapsing the best one into the canonical id and
 * tombstoning the rest, so `all('user_profile')` always settles to one row.
 */
import { all, put, softDeleteMany, withSyncFields } from './repo';
import type { UserProfile } from './types';

/** Fixed primary key for the single user_profile row. */
export const USER_PROFILE_ID = 'workoutt-user-profile';

/** Best profile when duplicates exist: completed-onboarding beats not, then
 *  the most recently updated wins. */
function pickBest(rows: UserProfile[]): UserProfile {
  return [...rows].sort((a, b) => {
    const ac = a.onboarding_completed_at ? 1 : 0;
    const bc = b.onboarding_completed_at ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  })[0];
}

/**
 * Read the profile, collapsing duplicates into the singleton id. Returns
 * undefined only when no profile exists at all.
 */
export async function getProfile(): Promise<UserProfile | undefined> {
  const rows = await all<UserProfile>('user_profile');
  if (rows.length === 0) return undefined;
  if (rows.length === 1 && rows[0].id === USER_PROFILE_ID) return rows[0];

  // Merge the best row into the canonical id and drop the strays. Preserving
  // the winner's fields; only its id changes.
  const best = pickBest(rows);
  await put('user_profile', { ...best, id: USER_PROFILE_ID });
  const strays = rows.filter((r) => r.id !== USER_PROFILE_ID).map((r) => r.id);
  if (strays.length) await softDeleteMany('user_profile', strays);
  return (await getProfile());
}

/**
 * Build a brand-new profile row at the singleton id. Use for onboarding /
 * seeds instead of `withSyncFields`, which would generate a random id.
 */
export function newProfile(
  fields: Omit<UserProfile, keyof import('./types').SyncFields>
): UserProfile {
  return { ...withSyncFields(fields), id: USER_PROFILE_ID };
}
