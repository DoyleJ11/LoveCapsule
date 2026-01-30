import {
  differenceInDays,
  format,
  setYear,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  getYear,
} from 'date-fns';

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
