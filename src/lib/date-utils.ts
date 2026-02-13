import {
  differenceInDays,
  format,
  getDate,
  setYear,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  getYear,
} from 'date-fns';

// ============================================
// Checkpoint Date Utilities
// ============================================
import type { CheckpointConfig, CheckpointFrequency } from '../types/database';

export function getDaysUntilAnniversary(anniversaryDate: string): number {
  const today = new Date();
  const anniversary = parseISO(anniversaryDate);

  // Set anniversary to current year
  let nextAnniversary = setYear(anniversary, getYear(today));

  // If it already passed this year, use next year
  if (isBefore(nextAnniversary, today) && !isSameDay(nextAnniversary, today)) {
    nextAnniversary = setYear(anniversary, getYear(today) + 1);
  }

  return differenceInDays(nextAnniversary, today);
}

export function isAnniversaryReady(
  anniversaryDate: string,
  lastRevealYear: number | null
): boolean {
  const today = new Date();
  const anniversary = parseISO(anniversaryDate);
  const anniversaryThisYear = setYear(anniversary, getYear(today));
  const currentYear = getYear(today);

  return (
    (isAfter(today, anniversaryThisYear) || isSameDay(today, anniversaryThisYear)) &&
    (lastRevealYear === null || lastRevealYear < currentYear)
  );
}

export function formatEntryDate(date: string): string {
  return format(parseISO(date), 'MMMM d, yyyy');
}

export function formatShortDate(date: string): string {
  return format(parseISO(date), 'MMM d');
}

export function formatRelativeDay(date: string): string {
  const parsed = parseISO(date);
  const today = new Date();

  if (isSameDay(parsed, today)) return 'Today';

  const diff = differenceInDays(today, parsed);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return format(parsed, 'EEEE');

  return format(parsed, 'MMM d');
}

export function getCurrentDateString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatCheckpointFrequency(
  frequency: CheckpointFrequency,
  specificDate?: string | null
): string {
  switch (frequency) {
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    case 'semi_annual':
      return 'Every 6 months';
    case 'specific_date':
      if (specificDate) {
        const parsed = parseISO(specificDate);
        const month = format(parsed, 'MMMM');
        const day = getDate(parsed);
        return `${month} ${getOrdinal(day)}`;
      }
      return 'Specific date';
    default:
      return frequency;
  }
}

export function formatCheckpointDescription(config: CheckpointConfig): string {
  const { frequency, day_of_month, months, specific_date, label } = config;

  if (label) return label;

  switch (frequency) {
    case 'monthly':
      return `Monthly on the ${getOrdinal(day_of_month || 1)}`;
    case 'quarterly':
      return `Quarterly on the ${getOrdinal(day_of_month || 1)}`;
    case 'semi_annual':
      return `Every 6 months on the ${getOrdinal(day_of_month || 1)}`;
    case 'specific_date':
      return specific_date ? format(parseISO(specific_date), 'MMMM d') : 'Specific date';
    default:
      return 'Checkpoint';
  }
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function getNextCheckpointDate(configs: CheckpointConfig[]): Date | null {
  if (configs.length === 0) return null;

  const today = new Date();
  const currentYear = getYear(today);
  const currentMonth = today.getMonth() + 1; // 1-12
  const currentDay = today.getDate();

  let nextDate: Date | null = null;

  for (const config of configs) {
    if (!config.is_active) continue;

    const candidateDates: Date[] = [];

    switch (config.frequency) {
      case 'monthly':
        // Next occurrence this month or next month
        if (config.day_of_month) {
          const thisMonth = new Date(currentYear, today.getMonth(), config.day_of_month);
          const nextMonth = new Date(currentYear, today.getMonth() + 1, config.day_of_month);
          if (isAfter(thisMonth, today) || isSameDay(thisMonth, today)) {
            candidateDates.push(thisMonth);
          }
          candidateDates.push(nextMonth);
        }
        break;

      case 'quarterly':
      case 'semi_annual':
        if (config.day_of_month && config.months) {
          for (const month of config.months) {
            const date = new Date(currentYear, month - 1, config.day_of_month);
            if (isAfter(date, today) || isSameDay(date, today)) {
              candidateDates.push(date);
            }
            // Also check next year
            const nextYearDate = new Date(currentYear + 1, month - 1, config.day_of_month);
            candidateDates.push(nextYearDate);
          }
        }
        break;

      case 'specific_date':
        if (config.specific_date) {
          const date = parseISO(config.specific_date);
          // Set to current year
          let thisYearDate = setYear(date, currentYear);
          if (isBefore(thisYearDate, today) && !isSameDay(thisYearDate, today)) {
            thisYearDate = setYear(date, currentYear + 1);
          }
          candidateDates.push(thisYearDate);
        }
        break;
    }

    for (const candidate of candidateDates) {
      if (nextDate === null || isBefore(candidate, nextDate)) {
        nextDate = candidate;
      }
    }
  }

  return nextDate;
}

export function formatNextCheckpointDate(date: Date | null): string {
  if (!date) return 'No upcoming checkpoints';

  const today = new Date();
  if (isSameDay(date, today)) return 'Today';

  const days = differenceInDays(date, today);
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;

  return format(date, 'MMM d');
}
