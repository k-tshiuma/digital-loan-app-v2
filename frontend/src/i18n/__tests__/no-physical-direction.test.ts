// Phase 4 guard (T4.1): layouts must mirror in Hebrew, so components use logical Tailwind classes
// (ms/me/ps/pe/start/end/text-start/border-s/rounded-s...) instead of left/right ones.
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');
// Shared components (used by both apps) live in shared/frontend and follow the same rules.
const SHARED = path.resolve(SRC, '../../shared/frontend');
const componentsIn = (dir: string) =>
  fs
    .readdirSync(path.join(dir, 'components'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(dir, 'components', f));
const FILES = [path.join(SRC, 'App.tsx'), ...componentsIn(SRC), ...componentsIn(SHARED)];

// A physical class token, with optional variants (hover:, sm:, before: ...).
const PHYSICAL =
  /(?<=[\s"'`{])(?:[a-z-]+:)*-?(?:(?:ml|mr|pl|pr|left|right)-(?!1\/2\b)[\w./[\]%-]+|text-(?:left|right)|border-[lr](?:-[\w-]+)?|rounded-(?:l|r|tl|tr|bl|br)(?:-[\w-]+)?)(?=[\s"'`}])/g;

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

describe('No left/right-specific layout classes (T4.1)', () => {
  it('self-check: the pattern catches physical classes and allows centring helpers', () => {
    const sample = 'className="pl-4 text-right hover:mr-2 -ml-1.5 border-r rounded-tl-xl left-1/2 ps-4 text-start"';
    expect([...sample.matchAll(PHYSICAL)].map((m) => m[0])).toEqual([
      'pl-4',
      'text-right',
      'hover:mr-2',
      '-ml-1.5',
      'border-r',
      'rounded-tl-xl',
    ]);
  });

  for (const file of FILES) {
    const name = path.basename(file);
    const src = fs.readFileSync(file, 'utf8');

    it(`${name} uses logical classes only`, () => {
      const found: string[] = [];
      for (const m of src.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})/g)) {
        for (const p of m[0].matchAll(PHYSICAL)) found.push(`${name}:${lineOf(src, m.index! + p.index!)}  ${p[0]}`);
      }
      expect(found).toEqual([]);
    });

    it(`${name} flips direction-implying icons and hover nudges in RTL`, () => {
      const problems: string[] = [];
      for (const m of src.matchAll(/<(ChevronRight|ChevronLeft|ArrowRight|ArrowLeft)\b[^>]*>/g)) {
        if (!m[0].includes('rtl:rotate-180')) problems.push(`${name}:${lineOf(src, m.index!)}  ${m[1]} without rtl:rotate-180`);
      }
      for (const m of src.matchAll(/group-hover:translate-x-([\d.]+)/g)) {
        const after = src.slice(m.index!, m.index! + 80);
        if (!after.includes(`rtl:group-hover:-translate-x-${m[1]}`)) {
          problems.push(`${name}:${lineOf(src, m.index!)}  hover nudge without an RTL counterpart`);
        }
      }
      if (/\bdir-ltr\b/.test(src)) problems.push(`${name}: uses the undefined "dir-ltr" class; use dir="ltr"`);
      expect(problems).toEqual([]);
    });
  }
});
