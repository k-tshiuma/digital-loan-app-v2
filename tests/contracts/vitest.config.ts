/// <reference types="vitest/config" />
// Contract tests: frontend code checked against backend files (PDF labels, status reasons, mirrored
// logic). They read both sides by path, so they live outside either app. Run from the repo root with
// `npm run test:contracts`. Only the shared dictionary is loaded: these labels are shared ones.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
