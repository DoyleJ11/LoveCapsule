import type { Couple } from '../types/database';

/**
 * Valentine's Day Surprise — trigger logic and letter content.
 *
 * Target: Feb 13, 2026 at 6:00 PM PST (= Feb 14, 2026 02:00 UTC).
 */

// 6 PM PST on Feb 13, 2026 expressed in UTC
const VALENTINE_TRIGGER_UTC = new Date('2026-02-14T02:00:00Z');

const ASYNC_STORAGE_KEY = 'valentine_surprise_completed';

/** Check whether the scheduled time has arrived. */
export function isValentineTime(): boolean {
  return new Date() >= VALENTINE_TRIGGER_UTC;
}

/**
 * Determine whether the valentine surprise should be shown.
 *
 * @param couple   - The current couple record (null if not paired)
 * @param isCompleted - Whether the user already finished the full flow (from AsyncStorage)
 * @param isDev    - Whether we're running in dev mode (__DEV__)
 */
export function shouldShowValentine(
  couple: Couple | null,
  isCompleted: boolean,
  isDev: boolean
): boolean {
  if (isCompleted) return false;
  if (!couple) return false;
  if (isDev) return true;
  if (isValentineTime()) return true;
  if (couple.valentine_surprise_triggered) return true;
  return false;
}

export { ASYNC_STORAGE_KEY as VALENTINE_STORAGE_KEY };

// ---------------------------------------------------------------------------
// Letter content
// ---------------------------------------------------------------------------

export const VALENTINE_LETTER_PARAGRAPHS: string[] = [
  'I bet you thought I forgot to ask you a very important question before Valentine\u2019s Day, didn\u2019t you\u2026 \ud83e\udd28',
  'In all seriousness, I\u2019m so lucky to have you in my life. I\u2019ve never been so excited to make memories with someone as I am with you. In the short three months since our first date, I can already feel the positive effect you\u2019ve had on my life. Thinking of you helps me work harder and stay disciplined when I\u2019m losing motivation. Knowing when I get to see you next gives me something to look forward to when I\u2019m having a tough week.',
  'You\u2019ve somehow made getting on the ferry to Seattle something I look forward to, something I never thought I\u2019d say. I can\u2019t wipe the smile off my face as I round the corner to your apartment, excited to see your beautiful smile.',
  'Alyssa, I couldn\u2019t be more excited to build something special with you.',
];
