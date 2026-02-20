import { UNKNOWN_VALUES } from './constants';

export function normalizeField(field: string): string {
  return field
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function hasKnownValue(value: unknown): boolean {
  const token = String(value ?? '').trim().toLowerCase();
  return !UNKNOWN_VALUES.has(token);
}

export function humanizeField(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
