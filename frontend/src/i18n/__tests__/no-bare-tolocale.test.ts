// Phase 5 guard (T5.2): numbers and dates in the UI go through i18n/format.ts, so they follow
// the app language instead of the browser locale. Hand-written "₪{...}" prefixes are caught too.
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

const BARE_LOCALE = /\.toLocale(?:String|DateString|TimeString)\(/g;
const SHEKEL_PREFIX = /₪\{/g;

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

describe('Locale-aware formatting only (T5.2)', () => {
  for (const file of FILES) {
    const name = path.basename(file);
    const src = fs.readFileSync(file, 'utf8');

    it(`${name} uses i18n/format.ts for numbers, amounts and dates`, () => {
      const found: string[] = [];
      for (const m of src.matchAll(BARE_LOCALE)) found.push(`${name}:${lineOf(src, m.index!)}  ${m[0]}`);
      for (const m of src.matchAll(SHEKEL_PREFIX)) found.push(`${name}:${lineOf(src, m.index!)}  hand-written ₪ prefix`);
      expect(found).toEqual([]);
    });
  }
});
