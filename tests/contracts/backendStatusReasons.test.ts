// Contract: every fixed status reason the backend writes into the status history is one the frontend
// knows how to translate (DEFAULT_STATUS_REASONS in shared/frontend/i18n/options.ts).
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { DEFAULT_STATUS_REASONS } from '@quickloan/ui-core/i18n/options';

describe('statusReasonLabel', () => {
  it('knows every fixed reason the backend writes into the status history', () => {
    // server.js and the route modules split out of it (routes/borrower, routes/admin, routes/shared).
    const backend = path.resolve(__dirname, '../../backend');
    const files = [
      path.join(backend, 'server.js'),
      ...['borrower', 'admin', 'shared'].flatMap((dir) =>
        fs.readdirSync(path.join(backend, 'routes', dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(backend, 'routes', dir, f))
      ),
    ];
    const server = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const known = Object.values(DEFAULT_STATUS_REASONS) as string[];
    // `reason: 'text'` or `reason: (...) || 'fallback text'`
    const written = [...server.matchAll(/reason:\s*(?:'([^']+)'|[^\n]*\|\|\s*'([^']+)')/g)].map((m) => m[1] ?? m[2]);
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((r) => !known.includes(r))).toEqual([]);
  });
});
