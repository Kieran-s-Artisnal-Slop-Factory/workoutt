/**
 * Unit conversion + formatting. Storage is ALWAYS canonical metric (kg, km,
 * seconds); these helpers convert to/from the user's display units at the
 * edges only.
 */
import type { DistanceUnit, WeightUnit } from '../db/types';

const KG_PER_LB = 0.45359237;
const KM_PER_MI = 1.609344;

export function kgToDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

export function displayToKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

export function kmToDisplay(km: number, unit: DistanceUnit): number {
  return unit === 'km' ? km : km / KM_PER_MI;
}

export function displayToKm(value: number, unit: DistanceUnit): number {
  return unit === 'km' ? value : value * KM_PER_MI;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${round1(kgToDisplay(kg, unit))} ${unit}`;
}

export function formatDistance(km: number, unit: DistanceUnit): string {
  return `${round1(kmToDisplay(km, unit))} ${unit}`;
}

/** Seconds → "1:05:30", "28:00", or "45s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Pace for distance_time exercises: seconds+km → "5:36 /km". */
export function formatPace(timeSeconds: number, km: number, unit: DistanceUnit): string {
  if (km <= 0) return '—';
  const dist = kmToDisplay(km, unit);
  const secPerUnit = timeSeconds / dist;
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  return `${m}:${String(s).padStart(2, '0')} /${unit}`;
}
