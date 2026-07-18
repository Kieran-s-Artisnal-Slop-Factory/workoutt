/**
 * Client side of the notification system (notifications.md).
 *
 * Two jobs:
 *  1. Web Push subscription — register this browser with the sync server so it
 *     can push reminders while the app is closed. Requires the service worker,
 *     which only runs in a production build / installed PWA.
 *  2. In-app local notifications — shown immediately while the app is open
 *     (the reliable, no-server path for the 45-min stale-workout nudge, and a
 *     fallback everywhere Web Push isn't available).
 *
 * The server base URL is the sync URL (empty = same origin, which is correct
 * when the Go backend serves the frontend).
 */
import { getSyncUrl } from './sync';

const base = () => getSyncUrl();

export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function notificationPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'denied' : Notification.permission;
}

/** Ask for notification permission (must be called from a user gesture). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

/** VAPID keys are base64url; the Push API wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null; // SW isn't registered (e.g. dev build)
  return navigator.serviceWorker.ready;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  const reg = await readyRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export interface SubscribeResult {
  ok: boolean;
  reason?: string;
}

/**
 * Subscribe this browser to Web Push and register it with the server. Needs an
 * active service worker (production build) and granted permission.
 */
export async function subscribeThisDevice(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  const reg = await readyRegistration();
  if (!reg) return { ok: false, reason: 'no-service-worker' };
  if ((await requestNotificationPermission()) !== 'granted') {
    return { ok: false, reason: 'permission' };
  }
  try {
    const res = await fetch(`${base()}/push/vapid-public-key`);
    if (!res.ok) return { ok: false, reason: 'no-key' };
    const { key } = (await res.json()) as { key: string };

    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));

    const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
    const post = await fetch(`${base()}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        device_label: navigator.userAgent.slice(0, 120),
      }),
    });
    return post.ok ? { ok: true } : { ok: false, reason: 'server' };
  } catch (err) {
    console.error('[workoutt notifications] subscribe failed:', err);
    return { ok: false, reason: 'error' };
  }
}

/** Remove this browser's push subscription locally and on the server. */
export async function unsubscribeThisDevice(): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await fetch(`${base()}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  } catch (err) {
    console.error('[workoutt notifications] unsubscribe failed:', err);
  }
  await sub.unsubscribe().catch(() => {});
}

export interface LocalNotification {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/**
 * Show a notification right now (app is open). Prefers the service worker so a
 * click can route via `notificationclick`; falls back to the page Notification
 * constructor when there's no SW (dev build).
 */
export async function showLocalNotification(n: LocalNotification): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false;
  const reg = await readyRegistration();
  const options: NotificationOptions = {
    body: n.body,
    tag: n.tag,
    // `data.url` is what the SW notificationclick handler navigates to.
    data: { url: n.url ?? '/' },
  } as NotificationOptions;
  try {
    if (reg) {
      await reg.showNotification(n.title, options);
    } else {
      new Notification(n.title, options);
    }
    return true;
  } catch (err) {
    console.error('[workoutt notifications] show failed:', err);
    return false;
  }
}

/** Milliseconds until a workout started at `startedAtIso` becomes "stale". */
export const STALE_WORKOUT_MS = 45 * 60 * 1000;

export function msUntilStale(startedAtIso: string, now = Date.now()): number {
  return Date.parse(startedAtIso) + STALE_WORKOUT_MS - now;
}
