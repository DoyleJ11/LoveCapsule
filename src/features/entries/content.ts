/** Plain text is canonical. Generating HTML must never change the diary's words. */
export function entryContent(plain: string) {
  const escaped = plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    content_plain: plain,
    content_html: `<p>${escaped.replace(/\n/g, '</p><p>')}</p>`,
    word_count: plain.trim() ? plain.trim().split(/\s+/).length : 0,
  };
}
