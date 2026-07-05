/**
 * JSON backup export/import. This is the only backup mechanism until sync
 * ships in Phase 3. Exports include tombstoned rows (it's a full copy of the
 * store, not a view); import replaces the entire database contents.
 *
 * Envelope format (see plan.md): {schemaVersion, exportedAt, data: {storeName: rows[]}}
 */
import { getDB, DB_VERSION } from './db';
import { STORES } from './types';

export interface ExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export async function exportData(): Promise<ExportEnvelope> {
  const db = await getDB();
  const data: Record<string, unknown[]> = {};
  for (const name of Object.keys(STORES)) {
    data[name] = await db.getAll(name);
  }
  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** Trigger a browser download of the backup file. */
export async function downloadExport(): Promise<void> {
  const envelope = await exportData();
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workoutt-backup-${envelope.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Replace the entire database contents with the backup's. */
export async function importData(envelope: ExportEnvelope): Promise<void> {
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

  const db = await getDB();
  const names = Object.keys(STORES);
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const store = tx.objectStore(name);
    store.clear();
    for (const row of envelope.data[name] ?? []) {
      store.put(row);
    }
  }
  await tx.done;
}
