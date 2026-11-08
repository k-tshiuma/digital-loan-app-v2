/// <reference types="vitest/config" />
// Tests for the shared frontend code, run without any app's message groups: everything shared code
// shows must come from the shared dictionary.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test-utils/setup.ts'],
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    css: false,
  },
});
