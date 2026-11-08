import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { scanFile } from './hardcodedText';
import { BASE_TRANSLATIONS } from '@quickloan/ui-core/i18n/translations';
import { MESSAGE_MODULES } from '@quickloan/ui-core/i18n/messages';

const COMPONENTS = path.resolve(__dirname, '../../components');
// Shared components (used by both apps) live in shared/frontend and follow the same rules.
const SHARED_COMPONENTS = path.resolve(__dirname, '../../../../shared/frontend/components');

// Files still being converted. Empty since Phase 3 finished; add a file here only temporarily.
const PENDING = new Set<string>();

const APP = path.resolve(__dirname, '../../App.tsx');
const files = fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.tsx'));
const sharedFiles = fs.readdirSync(SHARED_COMPONENTS).filter((f) => f.endsWith('.tsx'));
const fullPath = (f: string) =>
  f === 'App.tsx' ? APP : sharedFiles.includes(f) ? path.join(SHARED_COMPONENTS, f) : path.join(COMPONENTS, f);
files.push(...sharedFiles);
files.push('App.tsx');

describe('No hard-coded English in components (T3.1)', () => {
  for (const file of files.filter((f) => !PENDING.has(f))) {
    it(`${file} uses t() for all visible text`, () => {
      const findings = scanFile(fullPath(file)).map((f) => `${f.file}:${f.line}  ${f.text}`);
      expect(findings).toEqual([]);
    });
  }

  it('the pending list only names files that still need work', () => {
    const doneButListed = [...PENDING].filter((f) => files.includes(f) && scanFile(fullPath(f)).length === 0);
    expect(doneButListed).toEqual([]);
  });
});

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
