import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { differenceInYears, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function logToServer(level: 'debug' | 'info' | 'warn' | 'error', message: string, source: string) {
  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, source }),
    });
    if (!res.ok) console.error(`Failed to send log to server: HTTP ${res.status}`);
  } catch (e) {
    console.error("Failed to send log to server:", e);
  }
}

export function getLocalDateString(timezone?: string) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(new Date());
  } catch (e) {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export function formatWorkoutWeight(kg: number, preferredUnits: string = 'metric'): string {
  if (preferredUnits === 'imperial' || preferredUnits === 'stone') {
    return `${(kg * 2.20462).toFixed(1)} lbs`;
  }
  return `${kg.toFixed(1)} kg`;
}

export function formatWeight(kg: number, preferredUnits: string = 'metric'): string {
  if (preferredUnits === 'imperial') {
    return `${(kg * 2.20462).toFixed(1)} lbs`;
  }
  if (preferredUnits === 'stone') {
    const lbsTotal = kg * 2.20462;
    const stones = Math.floor(lbsTotal / 14);
    const lbs = (lbsTotal % 14).toFixed(1);
    return `${stones}st ${lbs}lb`;
  }
  return `${kg.toFixed(1)} kg`;
}

export function convertWeight(kg: number, preferredUnits: string = 'metric'): number {
  if (preferredUnits === 'imperial' || preferredUnits === 'stone') {
    return Number((kg * 2.20462).toFixed(1));
  }
  return Number(kg.toFixed(1));
}

export function convertDistance(km: number, preferredUnits: string = 'metric'): number {
  if (preferredUnits === 'imperial' || preferredUnits === 'stone') {
    return Number((km * 0.621371).toFixed(2));
  }
  return Number(km.toFixed(2));
}

export function getWeightUnit(preferredUnits: string = 'metric'): string {
  if (preferredUnits === 'imperial') return 'lbs';
  if (preferredUnits === 'stone') return 'st';
  return 'kg';
}

export function getDistanceUnit(preferredUnits: string = 'metric'): string {
  return (preferredUnits === 'imperial' || preferredUnits === 'stone') ? 'mi' : 'km';
}

export function formatPaceAndSpeed(distanceMeters: number, timeSeconds: number, preferredUnits: string = 'metric'): string {
  if (distanceMeters <= 0 || timeSeconds <= 0) return '';
  
  const km = distanceMeters / 1000;
  const mins = timeSeconds / 60;
  
  if (preferredUnits === 'imperial' || preferredUnits === 'stone') {
    const mi = km * 0.621371;
    const pace = mins / mi;
    const speed = mi / (mins / 60);
    return `${Math.floor(pace)}:${Math.round((pace % 1) * 60).toString().padStart(2, '0')} min/mi • ${speed.toFixed(1)} mph`;
  }
  
  const pace = mins / km;
  const speed = km / (mins / 60);
  return `${Math.floor(pace)}:${Math.round((pace % 1) * 60).toString().padStart(2, '0')} min/km • ${speed.toFixed(1)} km/h`;
}

/**
 * Robustly parse a date string from various sources (SQLite, ISO, local)
 * ensuring it is treated as UTC if no timezone is specified.
 */
export function parseUTCDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  
  let iso = String(dateStr).trim();
  const hasTimezone = /Z|[+-]\d{2}:?\d{2}/.test(iso) || iso.includes('GMT');
  const hasTime = iso.includes('T') || iso.includes(' ');

  if (!hasTimezone) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      iso = `${iso}T00:00:00`;
    } else if (iso.includes(' ') && !iso.includes('T')) {
      iso = iso.replace(' ', 'T');
    }
  }

  const d = new Date(iso);
  if (!isNaN(d.getTime())) return d;

  try {
    return parseISO(dateStr);
  } catch (e) {
    return new Date();
  }
}

export function formatDateWithTimezone(dateStr: string, timezone?: string): string {
  if (!dateStr) return '';
  
  const d = parseUTCDate(dateStr);
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { 
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(d);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    
    return `${getPart('day')}-${getPart('month')}-${getPart('year')} ${getPart('hour')}:${getPart('minute')}`;
  } catch (e) {
    // Fallback if timezone is invalid
    try {
      return d.toLocaleString('en-GB', { 
        timeZone: tz !== 'UTC' && tz !== 'undefined' ? tz : undefined,
        hour12: false 
      });
    } catch (err) {
      return d.toISOString().replace('T', ' ').substring(0, 16);
    }
  }
}

export function convertHeight(meters: number, preferredUnits: string = 'metric'): number {
  if (preferredUnits === 'imperial') {
    return Number((meters * 39.3701).toFixed(1)); // inches
  }
  return Number(meters.toFixed(2));
}

export function getHeightUnit(preferredUnits: string = 'metric'): string {
  return preferredUnits === 'imperial' ? 'in' : 'm';
}

export function normalizeAIMarkdown(content: string | null | undefined): string {
  if (!content) return '';

  const raw = String(content).trim();
  if (!raw) return '';

  const lines = raw.split(/\r?\n/);
  const cleaned: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([\w-]*)\s*$/);

    if (fenceMatch) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      cleaned.push(line);
    } else {
      cleaned.push(line);
    }
  }

  return cleaned.join('\n').trim();
}

export function calculateAge(dob: string) {
  if (!dob) return 0;
  try {
    return differenceInYears(new Date(), parseISO(dob));
  } catch (e) {
    return 0;
  }
}
