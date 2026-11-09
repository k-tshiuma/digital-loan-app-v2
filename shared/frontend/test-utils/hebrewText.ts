// Render-test helper: finds visible English sentences in a screen that should be fully in Hebrew.

/** Two or more Latin words in a row (e.g. "Loan Details"). Single brand words like "QuickLoan" are fine. */
export const ENGLISH_SENTENCE = /\b[A-Za-z]{3,}(?:\s+[A-Za-z]{3,})+\b/;

/** Visible English sentences inside an element, ignoring user data passed in `allow`. */
export function englishIn(el: HTMLElement, allow: string[] = []): string[] {
  let text = el.textContent || '';
  for (const a of allow) text = text.split(a).join(' ');
  const found: string[] = [];
  const re = new RegExp(ENGLISH_SENTENCE.source, 'g');
  for (const m of text.matchAll(re)) found.push(m[0]);
  const attrs = [...el.querySelectorAll('[placeholder],[title],[aria-label]')].flatMap((n) =>
    ['placeholder', 'title', 'aria-label'].map((a) => n.getAttribute(a) || '')
  );
  for (let a of attrs) {
    for (const x of allow) a = a.split(x).join(' ');
    if (ENGLISH_SENTENCE.test(a)) found.push(`[attr] ${a}`);
  }
  return found;
}
