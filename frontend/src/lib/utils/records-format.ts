/** Formatting for derived PR values, shared by Records and Home pages. */
import type { DistanceUnit, WeightUnit } from '../db/types';
import type { RecordEntry } from '../services/records';
import { formatWeight, formatDistance, formatDuration, kgToDisplay } from './units';

export function formatRecordValue(
  label: string,
  entry: RecordEntry,
  wu: WeightUnit,
  du: DistanceUnit
): string {
  switch (label) {
    case 'Max weight': {
      const base = formatWeight(entry.value, wu);
      return entry.secondary != null ? `${base} × ${Math.round(entry.secondary)}` : base;
    }
    case 'Max volume (single set)':
      return `${Math.round(kgToDisplay(entry.value, wu) * 10) / 10} ${wu}·reps`;
    case 'Max reps':
      return `${Math.round(entry.value)} reps`;
    case 'Longest time':
      return formatDuration(entry.value);
    case 'Longest distance':
      return formatDistance(entry.value, du);
    case 'Best pace': {
      // value is seconds per km; convert to seconds per display unit
      const secPerUnit = du === 'km' ? entry.value : entry.value * 1.609344;
      const m = Math.floor(secPerUnit / 60);
      const s = Math.round(secPerUnit % 60);
      return `${m}:${String(s).padStart(2, '0')} /${du}`;
    }
    default:
      return String(Math.round(entry.value * 10) / 10);
  }
}
