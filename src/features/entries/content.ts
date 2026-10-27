import { toContentHtml, countWords } from '../../lib/entry-content';

/** Share the upstream canonical encoding with both save paths. */
export function entryContent(plain: string) {
  return {
    content_plain: plain,
    content_html: toContentHtml(plain),
    word_count: countWords(plain),
  };
}
