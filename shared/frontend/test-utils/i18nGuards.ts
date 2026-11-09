// i18n and RTL guards, shared by both apps and the shared package. Each suite calls these with its own
// files, after its own message groups are registered (the test setup does that), so every check runs
// against the dictionary that suite really ships.
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { scanFile } from './hardcodedText';
import { BASE_TRANSLATIONS, TRANSLATIONS } from '../i18n/translations';
import { MESSAGE_MODULES } from '../i18n/messages';

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

/** App.tsx (if there is one) and every .tsx in <dir>/components. */
export function componentFiles(dir: string): string[] {
  const app = path.join(dir, 'App.tsx');
  return [
    ...(fs.existsSync(app) ? [app] : []),
    ...fs
      .readdirSync(path.join(dir, 'components'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => path.join(dir, 'components', f)),
  ];
}

/** No visible English in JSX; every text goes through t() (T3.1). */
export function describeHardcodedText(files: string[], pending: Set<string> = new Set()) {
  const names = files.map((f) => path.basename(f));
  const fullPath = (name: string) => files[names.indexOf(name)];

  describe('No hard-coded English in components (T3.1)', () => {
    for (const file of names.filter((f) => !pending.has(f))) {
      it(`${file} uses t() for all visible text`, () => {
        const findings = scanFile(fullPath(file)).map((f) => `${f.file}:${f.line}  ${f.text}`);
        expect(findings).toEqual([]);
      });
    }

    it('the pending list only names files that still need work', () => {
      const doneButListed = [...pending].filter((f) => names.includes(f) && scanFile(fullPath(f)).length === 0);
      expect(doneButListed).toEqual([]);
    });
  });
}

/** Message groups: no key defined twice, and the same keys in English and Hebrew. */
export function describeMessageGroups() {
  describe('Message groups', () => {
    it('no key is defined twice (base dictionary or another group)', () => {
      const seen = new Map<string, string>(Object.keys(BASE_TRANSLATIONS.en).map((k) => [k, 'base']));
      const dupes: string[] = [];
      for (const [group, mod] of Object.entries(MESSAGE_MODULES)) {
        for (const k of Object.keys(mod.en)) {
          if (seen.has(k)) dupes.push(`${k} (${seen.get(k)} and ${group})`);
          seen.set(k, group);
        }
      }
      expect(dupes).toEqual([]);
    });

    it('every group has the same keys in English and Hebrew', () => {
      const problems: string[] = [];
      for (const [group, mod] of Object.entries(MESSAGE_MODULES)) {
        const en = Object.keys(mod.en);
        const he = Object.keys(mod.he);
        en.filter((k) => !he.includes(k)).forEach((k) => problems.push(`${group}: ${k} missing in he`));
        he.filter((k) => !en.includes(k)).forEach((k) => problems.push(`${group}: ${k} missing in en`));
      }
      expect(problems).toEqual([]);
    });
  });
}

// A physical class token, with optional variants (hover:, sm:, before: ...).
const PHYSICAL =
  /(?<=[\s"'`{])(?:[a-z-]+:)*-?(?:(?:ml|mr|pl|pr|left|right)-(?!1\/2\b)[\w./[\]%-]+|text-(?:left|right)|border-[lr](?:-[\w-]+)?|rounded-(?:l|r|tl|tr|bl|br)(?:-[\w-]+)?)(?=[\s"'`}])/g;

/** Layouts mirror in Hebrew: logical Tailwind classes only, and direction icons flip (T4.1). */
export function describePhysicalDirection(files: string[]) {
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

    for (const file of files) {
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
}

const BARE_LOCALE = /\.toLocale(?:String|DateString|TimeString)\(/g;
const SHEKEL_PREFIX = /₪\{/g;

/** Numbers and dates go through i18n/format.ts, not the browser locale (T5.2). */
export function describeBareLocale(files: string[]) {
  describe('Locale-aware formatting only (T5.2)', () => {
    for (const file of files) {
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
}

/**
 * Every literal t() key used in these files exists in English and Hebrew. `minChecked` guards against
 * the pattern silently matching nothing; set it a little under the suite's real count.
 */
export function describeKeysExist(files: string[], minChecked: number) {
  const has = (key: string) => !!TRANSLATIONS.en[key] && !!TRANSLATIONS.he[key];
  describe('Every t() key used in the code exists in English and Hebrew', () => {
    it('no component or App references a missing key', () => {
      const missing: string[] = [];
      let checked = 0;
      for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        // t(language, 'key') / t(currentLanguage, "key") / t(this.props.language || 'en', 'key')
        for (const m of src.matchAll(/\bt\([^,()]+(?:\|\|\s*'en')?,\s*['"]([^'"]+)['"]/g)) {
          checked++;
          if (!has(m[1])) missing.push(`${path.basename(file)}: ${m[1]}`);
        }
      }
      expect(checked).toBeGreaterThan(minChecked);
      expect([...new Set(missing)]).toEqual([]);
    });
  });
}

/** Date fields use <DateInput>, never a native date field that shows the browser's format. */
export function describeNoNativeDate(files: string[]) {
  describe('Guard', () => {
    it('no component shows a native date field directly (they show the browser format)', () => {
      const offenders = files
        .filter((f) => path.basename(f) !== 'DateInput.tsx')
        .filter((f) => /type=["']date["']/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.basename(f));
      expect(offenders).toEqual([]);
    });
  });
}

const HEBREW_CHAR = /[֐-׿]/;
const placeholders = (s: string) => (s.match(/\{\w+\}/g) || []).sort();
// Hebrew values that legitimately contain no Hebrew letters (brand names, codes, symbols).
const NO_HEBREW_ALLOWED = new Set<string>(['currencySymbol', 'phoneNumberPlaceholder']);

/** The Hebrew dictionary is complete and well-formed (T0.1–T0.5). */
export function describeDictionary() {
  describe('Hebrew dictionary (T0.1–T0.5)', () => {
    const en = TRANSLATIONS.en;
    const he = TRANSLATIONS.he;
    const enKeys = () => Object.keys(en);
    const heKeys = () => Object.keys(he);

    it('T0.1 has every English key and no extra keys', () => {
      const missing = enKeys().filter((k) => !(k in he));
      const extra = heKeys().filter((k) => !(k in en));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it('T0.2 has no empty values or values equal to their key', () => {
      const bad = heKeys().filter((k) => !he[k] || !he[k].trim() || he[k] === k);
      expect(bad).toEqual([]);
    });

    it('T0.3 keeps the same {placeholders} as English', () => {
      const mismatched = enKeys()
        .filter((k) => k in he)
        .filter((k) => placeholders(en[k]).join() !== placeholders(he[k]).join())
        .map((k) => `${k}: en=${placeholders(en[k])} he=${placeholders(he[k])}`);
      expect(mismatched).toEqual([]);
    });

    it('T0.5 every value contains Hebrew letters (except allowlisted keys)', () => {
      const notHebrew = heKeys().filter((k) => !NO_HEBREW_ALLOWED.has(k) && !HEBREW_CHAR.test(he[k]));
      expect(notHebrew).toEqual([]);
    });
  });
}

