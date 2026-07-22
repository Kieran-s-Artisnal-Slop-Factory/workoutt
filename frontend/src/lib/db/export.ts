/**
 * JSON backup export/import. This is the only backup mechanism until sync
 * ships in Phase 3. Exports include tombstoned rows (it's a full copy of the
 * store, not a view).
 *
 * Envelope format (see plan.md):
 *   {schemaVersion, exportedAt, scope, data: {storeName: rows[]}}
 *
 * Scopes let the user carry just the reusable definitions or everything:
 *   - 'templates'      → exercises + workout/program templates (shareable)
 *   - 'templates_user' → the above plus profile, body weight, and full history
 *
 * Import behaviour depends on scope:
 *   - templates       → MERGE (rows are added/updated by id; existing data,
 *                       including your history and profile, is left intact)
 *   - templates_user  → REPLACE (clear the in-scope stores, then load — a
 *                       full restore)
 */
import { getDB, DB_VERSION } from './db';
import { STORES } from './types';
import { resetSyncCursors } from '../sync';

export type ExportScope = 'templates' | 'templates_user';

export interface ExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  scope?: ExportScope;
  data: Record<string, unknown[]>;
}

/** Reusable definitions — the shareable building blocks. */
const TEMPLATE_STORES = [
  'exercises',
  'workout_templates',
  'workout_template_exercises',
  'program_templates',
  'program_template_workouts',
];

/** Everything user-specific, on top of the templates. */
const USER_STORES = [
  'user_profile',
  'body_weight_entries',
  'programs',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'achievement_awards',
  'pets',
  'pet_xp_events',
  'pet_active_spans',
];

export function storesForScope(scope: ExportScope): string[] {
  return scope === 'templates' ? TEMPLATE_STORES : [...TEMPLATE_STORES, ...USER_STORES];
}

export const SCOPE_LABELS: Record<ExportScope, string> = {
  templates: 'Templates only',
  templates_user: 'Templates and user information',
};

export async function exportData(scope: ExportScope): Promise<ExportEnvelope> {
  const db = await getDB();
  const data: Record<string, unknown[]> = {};
  for (const name of storesForScope(scope)) {
    data[name] = await db.getAll(name);
  }
  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    data,
  };
}

/** Trigger a browser download of the backup file. */
export async function downloadExport(scope: ExportScope): Promise<void> {
  const envelope = await exportData(scope);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workoutt-${scope}-${envelope.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Wipe every store, including sync bookkeeping. Developer-mode escape hatch —
 * the caller is responsible for confirming with the user first.
 */
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const names = [...Object.keys(STORES), 'sync_meta'];
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    tx.objectStore(name).clear();
  }
  await tx.done;
}

export interface ImportResult {
  scope: ExportScope;
  mode: 'merged' | 'replaced';
  rows: number;
}

/**
 * Load a backup. The file's own scope decides how much is loaded and whether
 * it merges or replaces; older files without a scope are treated as a full
 * replace for backward compatibility.
 */
export async function importData(envelope: ExportEnvelope): Promise<ImportResult> {
  if (
    typeof envelope !== 'object' ||
    typeof envelope.schemaVersion !== 'number' ||
    typeof envelope.data !== 'object'
  ) {
    throw new Error('Not a valid Workoutt backup file');
  }
  if (envelope.schemaVersion > DB_VERSION) {
    throw new Error(
      `Backup is from a newer app version (schema v${envelope.schemaVersion}, app has v${DB_VERSION})`
    );
  }

  const scope: ExportScope = envelope.scope ?? 'templates_user';
  // Only touch stores that both belong to the scope and exist in this app.
  const known = new Set(Object.keys(STORES));
  const names = storesForScope(scope).filter((n) => known.has(n));
  const merge = scope === 'templates';

  const db = await getDB();
  const tx = db.transaction(names, 'readwrite');
  let rows = 0;
  for (const name of names) {
    const store = tx.objectStore(name);
    if (!merge) store.clear();
    for (const row of envelope.data[name] ?? []) {
      store.put(row);
      rows++;
    }
  }
  await tx.done;

  // A REPLACE restore swaps the entire local dataset for the file's rows, whose
  // server_seq values came from a different device/server. The pull cursor now
  // over-states what we hold, so forget it: the next sync must re-pull from
  // scratch (since=0) and reconcile, or server history the import dropped is
  // never re-fetched. A MERGE leaves existing data and its cursor valid.
  if (!merge) await resetSyncCursors();

  return { scope, mode: merge ? 'merged' : 'replaced', rows };
}
