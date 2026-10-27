/**
 * Entry content encoding.
 *
 * The composer is a plain TextInput, so `content_plain` is the source of
 * truth and `content_html` is derived from it — not the other way round.
 * Deriving plain text back out of the HTML was how paragraph breaks and
 * any text containing `<`/`>` got destroyed (see migration 011).
 *
 * The app only ever emits <p> and </p>, so fromContentHtml() strips those
 * specific tags rather than running a generic /<[^>]*>/ strip. That makes
 * the conversion lossless for content the user typed angle brackets into:
 * "<p>3 < 4</p>" recovers as "3 < 4" instead of losing "< 4".
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;') // must run first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unescapeHtml(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&'); // must run last, or "&amp;lt;" collapses to "<"
}

/** Plain text -> storage HTML. One <p> per line, contents escaped. */
export function toContentHtml(plain: string): string {
  return plain
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** Storage HTML -> plain text. Inverse of toContentHtml(). */
export function fromContentHtml(html: string): string {
  if (!html) return '';

  const withNewlines = html
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/^\s*<p>/i, '')
    .replace(/<\/p>\s*$/i, '');

  return unescapeHtml(withNewlines);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
