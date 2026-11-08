// Contract: frontend copies of backend logic stay in step (risk flag codes, eligibility factor texts).
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from '@quickloan/ui-core/i18n/translations';
import { RISK_FLAG_CODES } from '@quickloan/ui-core/i18n/options';

const SHARED = path.resolve(__dirname, '../../shared/frontend');
const BACKEND = path.resolve(__dirname, '../../backend');

const has = (key: string) => !!TRANSLATIONS.en[key] && !!TRANSLATIONS.he[key];

describe('Risk flags (T3.6)', () => {
  const engine = fs.readFileSync(path.join(BACKEND, 'creditEngine.js'), 'utf8');

  it('the frontend code list matches what the credit engine can emit', () => {
    const pushed = [...engine.matchAll(/flags\.push\(['`](\w+):/g)].map((m) => m[1]);
    const exported = /RISK_FLAG_CODES = \[([^\]]+)\]/.exec(engine)?.[1].match(/\w+/g) ?? [];
    expect([...new Set(pushed)].sort()).toEqual([...RISK_FLAG_CODES].sort());
    expect([...exported].sort()).toEqual([...RISK_FLAG_CODES].sort());
  });
});

describe('Eligibility factor descriptions', () => {
  for (const file of [
    path.join(SHARED, 'services/eligibilityScoring.ts'),
    path.join(BACKEND, 'services/eligibilityScoring.js'),
  ]) {
    it(`${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file)} only uses keys that exist`, () => {
      const src = fs.readFileSync(file, 'utf8');
      const keys = [...src.matchAll(/'(elig\.[\w.]+)'/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThanOrEqual(18);
      expect(keys.filter((k) => !has(k))).toEqual([]);
    });
  }
});
