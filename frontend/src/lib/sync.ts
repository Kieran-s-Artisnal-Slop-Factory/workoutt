/**
 * Client sync loop (Phase 3, see plan.md "Key decisions").
 *
 * Push: send rows never accepted by the server (server_seq == null) or
 * modified since the last push (updated_at > lastPushAt); the server applies
 * last-write-wins and returns assigned server_seq values, which are written
 * back without touching updated_at.
 *
 * Pull: request rows with server_seq above our stored high-water mark and
 * apply them under LWW (tombstones simply overwrite — reads filter them).
 *
 * The server base URL defaults to same-origin (the Go backend serves the
 * built frontend in production) and can be overridden in Settings for a
 * separately-hosted frontend or development.
 */
import { getDB } from './db/db';
import { STORES } from './db/types';
import type { SyncFields } from './db/types';

const SYNC_URL_KEY = 'workoutt-sync-url';
const AUTO_SYNC_AT_KEY = 'workoutt-last-auto-sync';
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) ?? '';
}

export function setSyncUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed) localStorage.setItem(SYNC_URL_KEY, trimmed);
  else localStorage.removeItem(SYNC_URL_KEY);
}

async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = (await (await getDB()).get('sync_meta', key)) as { value: T } | undefined;
  return row?.value;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put('sync_meta', { key, value });
}

export interface SyncStatus {
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return {
    lastSyncAt: (await getMeta<string>('lastSyncAt')) ?? null,
    lastError: (await getMeta<string | null>('lastError')) ?? null,
  };
}

export async function syncNow(): Promise<SyncResult> {
  try {
    const db = await getDB();
    const base = getSyncUrl();

    // ---- push
    const lastPushAt = (await getMeta<string>('lastPushAt')) ?? '';
    const rows: Record<string, SyncFields[]> = {};
    let pushed = 0;
    let maxPushedUpdatedAt = lastPushAt;
    for (const store of Object.keys(STORES)) {
      const all = (await db.getAll(store)) as SyncFields[];
      const dirty = all.filter((r) => r.server_seq == null || r.updated_at > lastPushAt);
      if (dirty.length > 0) {
        rows[store] = dirty;
        pushed += dirty.length;
        for (const r of dirty) {
          if (r.updated_at > maxPushedUpdatedAt) maxPushedUpdatedAt = r.updated_at;
        }
      }
    }

    const pushRes = await fetch(`${base}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    if (!pushRes.ok) throw new Error(`push failed (${pushRes.status})`);
    const pushJson = (await pushRes.json()) as {
      accepted: { table: string; id: string; server_seq: number }[];
    };

    // Record assigned seqs without touching updated_at (not a user edit).
    for (const acc of pushJson.accepted) {
      const row = (await db.get(acc.table, acc.id)) as SyncFields | undefined;
      if (row) {
        row.server_seq = acc.server_seq;
        await db.put(acc.table, row);
      }
    }
    await setMeta('lastPushAt', maxPushedUpdatedAt);

    // ---- pull
    const since = (await getMeta<number>('lastPullSeq')) ?? 0;
    const pullRes = await fetch(`${base}/sync/pull?since=${since}`);
    if (!pullRes.ok) throw new Error(`pull failed (${pullRes.status})`);
    const pullJson = (await pullRes.json()) as {
      rows: Record<string, SyncFields[]>;
      latestSeq: number;
    };

    let pulled = 0;
    for (const [store, incoming] of Object.entries(pullJson.rows ?? {})) {
      if (!(store in STORES)) continue;
      for (const row of incoming) {
        const local = (await db.get(store, row.id)) as SyncFields | undefined;
        // LWW: apply unless we hold something strictly newer (which the next
        // push will send).
        if (!local || row.updated_at >= local.updated_at) {
          await db.put(store, row);
          pulled++;
        }
      }
    }
    await setMeta('lastPullSeq', pullJson.latestSeq ?? since);
    await setMeta('lastSyncAt', new Date().toISOString());
    await setMeta('lastError', null);
    return { ok: true, pushed: pushJson.accepted.length, pulled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await setMeta('lastError', message);
    } catch {
      // storage unavailable — nothing else to do
    }
    return { ok: false, pushed: 0, pulled: 0, error: message };
  }
}

/** Throttled background sync — safe to call on every page load. */
export function maybeAutoSync(): void {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;
  const last = Number(localStorage.getItem(AUTO_SYNC_AT_KEY) ?? 0);
  if (Date.now() - last < AUTO_SYNC_INTERVAL_MS) return;
  localStorage.setItem(AUTO_SYNC_AT_KEY, String(Date.now()));
  void syncNow();
}
