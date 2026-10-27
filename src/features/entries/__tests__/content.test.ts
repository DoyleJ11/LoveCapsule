import { entryContent } from '../content';

describe('canonical diary text', () => {
  it.each([
    'First paragraph\n\nSecond paragraph',
    'I love you <3 and 3 < 4 > 2',
    '& <p>literal tags</p> 💌',
    '',
    '  one\ttwo\nthree  ',
  ])('preserves repeated edit/save text: %s', (plain) => {
    let saved = entryContent(plain);
    for (let edit = 0; edit < 5; edit++) saved = entryContent(saved.content_plain);
    expect(saved.content_plain).toBe(plain);
  });
  it('escapes markup and counts the original words', () => {
    expect(entryContent('Hello <3\nYou & me')).toEqual({
      content_plain: 'Hello <3\nYou & me',
      content_html: '<p>Hello &lt;3</p><p>You &amp; me</p>',
      word_count: 5,
    });
  });
});
