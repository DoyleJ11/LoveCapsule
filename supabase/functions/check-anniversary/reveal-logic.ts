/**
 * Pure decision logic for the anniversary reveal.
 *
 * Deliberately dependency-free so it can be imported by the Deno edge
 * function AND unit-tested under Jest (supabase/functions is excluded
 * from tsc, so the .ts import specifier below is Deno-only).
 *
 * All comparisons are done in UTC: the edge runtime is the authority on
 * "today", and the client's local clock is not trusted.
 */

export type RevealDecision =
  | { status: 'ready'; year: number }
  | { status: 'already_revealed'; year: number }
  | { status: 'no_anniversary' }
  | { status: 'not_reached'; year: number; readyOn: string };

/**
 * Decide what should happen when a couple asks to open their capsule.
 *
 * @param anniversaryDate 'YYYY-MM-DD' (a Postgres DATE), or null
 * @param lastRevealYear  the year of the couple's most recent reveal, or null
 * @param now             current time; injected so tests are deterministic
 */
export function decideReveal(
  anniversaryDate: string | null | undefined,
  lastRevealYear: number | null | undefined,
  now: Date
): RevealDecision {
  const year = now.getUTCFullYear();

  if (!anniversaryDate) return { status: 'no_anniversary' };

  const [, rawMonth, rawDay] = anniversaryDate.split('-');
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !month || !day) {
    return { status: 'no_anniversary' };
  }

  // Idempotency: this year's capsule is already open, so a repeat call
  // is a success rather than an error. (A last_reveal_year in the future
  // is treated the same way — never re-open something already opened.)
  if (lastRevealYear != null && lastRevealYear >= year) {
    return { status: 'already_revealed', year };
  }

  // Feb 29 rolls to Mar 1 in non-leap years, matching the SQL helper
  // anniversary_in_year() used by the visibility policies.
  const anniversaryThisYear = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (todayUtc < anniversaryThisYear) {
    return {
      status: 'not_reached',
      year,
      readyOn: new Date(anniversaryThisYear).toISOString().slice(0, 10),
    };
  }

  return { status: 'ready', year };
}
