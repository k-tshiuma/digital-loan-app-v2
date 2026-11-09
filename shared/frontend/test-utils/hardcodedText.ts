// Finds user-visible English text written straight into JSX, which would not change with the language.
// Used by describeHardcodedText in i18nGuards.ts. Heuristic, not a parser: it looks at JSX text between tags and at
// placeholder/title/aria-label/alt attributes written as plain strings.
import fs from 'fs';
import path from 'path';

export interface Finding {
  file: string;
  line: number;
  text: string;
}

// Text that is fine to leave as-is in any language.
const ALLOWED_TEXT = [
  /^QuickLoan$/,
  /^(OTP|PDF|SMS|ID|IL|EN|NIS|ILS|API|SSE|JSON|URL|OK|N\/A|vs|x|×)$/i,
  /^[A-Z]{2,}[-_]?\d*$/, // codes such as QL-, TH
  /^(KB|MB)\)?$/, // file size units
  /^[\d\s.,:;%₪+\-–—/()#*·•|→←]+$/,
];

const isAllowed = (text: string) => ALLOWED_TEXT.some((re) => re.test(text.trim()));
const hasLatinWord = (text: string) => /[A-Za-z]{2,}/.test(text);
const CODE_KEYWORD = /^\s*(else|return|if|const|let|catch|finally|while|for)\b/;

/** Raw JSX text: after a closing '>' or after an expression's '}', up to the next '<' or '{'. */
function jsxTextChunks(source: string): Array<{ index: number; text: string }> {
  const chunks: Array<{ index: number; text: string }> = [];
  const re = /[>}]([^<>{}]+)(?=[<{])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const text = m[1];
    if (!text.trim()) continue;
    const before = source[m.index - 1];
    if (source[m.index] === '}') {
      // After an expression, only count text that starts on the same line and is followed by a tag:
      // `{n} months</span>` (trailing whitespace/newlines before the tag are fine).
      const after = source.slice(m.index + 1 + text.length);
      if (text.trimEnd().includes('\n') || !after.startsWith('<') || CODE_KEYWORD.test(text)) continue;
    } else if (before === '=' || before === '-') {
      continue; // arrow function `=>` or `->`
    }
    // Skip code picked up by accident: comparisons (`a > 0`), generics, ternaries.
    if (before === ' ' && !/^\s*\n/.test(text)) continue;
    if (/[;=]|&&|\|\||\?\.|\s\?\s/.test(text)) continue;
    const trimmed = text.trim();
    if (/^[|&)]/.test(trimmed) || /^[\w.]+\($/.test(trimmed) || /^\d+\)/.test(trimmed)) continue;
    const lead = text.length - text.trimStart().length;
    chunks.push({ index: m.index + 1 + lead, text: text.replace(/\s+/g, ' ').trim() });
  }
  return chunks;
}

function attributeStrings(source: string): Array<{ index: number; text: string }> {
  const out: Array<{ index: number; text: string }> = [];
  const re = /\b(placeholder|title|aria-label|alt|fallbackTitle)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push({ index: m.index, text: m[2] });
  return out;
}

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

export function scanFile(file: string): Finding[] {
  const raw = fs.readFileSync(file, 'utf8');
  // Blank out comments so commented-out JSX is ignored (keep length so line numbers stay right).
  const source = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (s, p1) => p1 + ' '.repeat(s.length - p1.length));

  // `i18n-ignore` on a line skips that line; `i18n-ignore-next-line` skips the line after it.
  const ignored = new Set<number>();
  raw.split(/\r?\n/).forEach((l, i) => {
    if (l.includes('i18n-ignore-next-line')) ignored.add(i + 2);
    else if (l.includes('i18n-ignore')) ignored.add(i + 1);
  });

  const findings: Finding[] = [];
  for (const { index, text } of [...jsxTextChunks(source), ...attributeStrings(source)]) {
    if (!hasLatinWord(text) || isAllowed(text)) continue;
    const line = lineOf(source, index);
    if (ignored.has(line)) continue;
    findings.push({ file: path.basename(file), line, text });
  }
  return findings;
}

export function scanDir(dir: string, files?: string[]): Finding[] {
  const names = files ?? fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  return names.flatMap((f) => scanFile(path.join(dir, f)));
}
