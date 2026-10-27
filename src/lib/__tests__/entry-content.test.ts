import {
  escapeHtml,
  unescapeHtml,
  toContentHtml,
  fromContentHtml,
  countWords,
} from '../entry-content';

describe('escapeHtml / unescapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`3 < 4 & 5 > 2 "q" 'a'`)).toBe(
      '3 &lt; 4 &amp; 5 &gt; 2 &quot;q&quot; &#39;a&#39;'
    );
  });

  it('round-trips text that already looks like an entity', () => {
    // The classic double-unescape trap: "&lt;" typed literally must come
    // back as "&lt;", not as "<".
    const typed = '&lt;not a tag&gt;';
    expect(unescapeHtml(escapeHtml(typed))).toBe(typed);
  });

  it('round-trips ampersand-heavy text', () => {
    const typed = 'Tom & Jerry && co. &amp; friends';
    expect(unescapeHtml(escapeHtml(typed))).toBe(typed);
  });
});

describe('toContentHtml', () => {
  it('wraps a single line', () => {
    expect(toContentHtml('hello')).toBe('<p>hello</p>');
  });

  it('emits one paragraph per line', () => {
    expect(toContentHtml('a\nb')).toBe('<p>a</p><p>b</p>');
  });

  it('preserves blank lines as empty paragraphs', () => {
    expect(toContentHtml('a\n\nb')).toBe('<p>a</p><p></p><p>b</p>');
  });

  it('escapes user text so it cannot be read back as markup', () => {
    expect(toContentHtml('3 < 4')).toBe('<p>3 &lt; 4</p>');
  });

  it('handles empty content', () => {
    expect(toContentHtml('')).toBe('<p></p>');
  });
});

describe('fromContentHtml', () => {
  it('returns empty string for empty input', () => {
    expect(fromContentHtml('')).toBe('');
  });

  it('unwraps a single paragraph', () => {
    expect(fromContentHtml('<p>hello</p>')).toBe('hello');
  });

  it('turns paragraph boundaries back into newlines', () => {
    expect(fromContentHtml('<p>a</p><p>b</p>')).toBe('a\nb');
  });

  it('treats <br> as a newline', () => {
    expect(fromContentHtml('<p>a<br>b</p>')).toBe('a\nb');
    expect(fromContentHtml('<p>a<br />b</p>')).toBe('a\nb');
  });

  describe('legacy rows written before the fix (unescaped HTML)', () => {
    // These are what migration 011 has to repair. The old code wrote raw
    // user text into the HTML, so recovery must not use a generic tag strip.
    it('recovers text containing angle brackets losslessly', () => {
      expect(fromContentHtml('<p>3 < 4</p>')).toBe('3 < 4');
    });

    it('recovers multi-paragraph text containing angle brackets', () => {
      expect(fromContentHtml('<p>a < b</p><p>c</p>')).toBe('a < b\nc');
    });

    it('recovers blank lines', () => {
      expect(fromContentHtml('<p>a</p><p></p><p>b</p>')).toBe('a\n\nb');
    });
  });
});

describe('parity with the migration 011 SQL repair', () => {
  // Migration 011 reimplements fromContentHtml() in SQL to repair existing
  // rows. These expectations were verified against real Postgres output; if
  // fromContentHtml changes, the SQL is now out of step with it.
  const cases: [string, string, number][] = [
    ['<p>first line</p><p>second line</p>', 'first line\nsecond line', 4],
    ['<p>is 3 < 4 > 2 ?</p>', 'is 3 < 4 > 2 ?', 7],
    ['<p>a</p><p></p><p>b</p>', 'a\n\nb', 2],
    ['<p>Tom & Jerry</p>', 'Tom & Jerry', 3],
    ['<p></p>', '', 0],
  ];

  it.each(cases)('%s', (html, expectedPlain, expectedWords) => {
    const plain = fromContentHtml(html);
    expect(plain).toBe(expectedPlain);
    expect(countWords(plain)).toBe(expectedWords);
  });
});

describe('round trip: plain -> html -> plain', () => {
  const cases: [string, string][] = [
    ['empty', ''],
    ['single line', 'hello world'],
    ['two paragraphs', 'first line\nsecond line'],
    ['blank line between paragraphs', 'first\n\nsecond'],
    ['angle brackets', 'is 3 < 4 or 3 > 4?'],
    ['ampersand', 'Tom & Jerry'],
    ['entity-looking text', 'type &lt;p&gt; to make a tag'],
    ['quotes', `she said "hi" and 'bye'`],
    ['emoji and accents', 'café ☕ 💛'],
    ['multiline with markup-ish text', 'line <b>one</b>\n\nline & <two>'],
  ];

  it.each(cases)('%s', (_label, plain) => {
    expect(fromContentHtml(toContentHtml(plain))).toBe(plain);
  });

  it('is stable across repeated save/edit cycles', () => {
    // The corruption compounded because edit mode reloads content_plain.
    let plain = 'para one < >\n\npara two & three';
    for (let i = 0; i < 5; i++) {
      plain = fromContentHtml(toContentHtml(plain));
    }
    expect(plain).toBe('para one < >\n\npara two & three');
  });
});

describe('countWords', () => {
  it('counts words separated by any whitespace', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('one\ntwo\n\nthree')).toBe(3);
    expect(countWords('  padded   words  ')).toBe(2);
  });

  it('returns 0 for empty or whitespace-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });

  it('counts newline-separated paragraphs correctly (the regression)', () => {
    // Previously newlines became "</p><p>" and then a single space, which
    // still counted correctly — but the stored text lost its structure.
    const plain = 'first paragraph here\nsecond paragraph here';
    expect(countWords(fromContentHtml(toContentHtml(plain)))).toBe(6);
  });
});
