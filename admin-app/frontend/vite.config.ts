/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Admin dashboard. Dev server on port 3001 (the borrower app uses 3000). VITE_API_URL points at the
// backend; until the backends split (Phase 6) both apps use the same one.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
