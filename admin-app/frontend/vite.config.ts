/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Admin dashboard. Dev server on port 3001 (the borrower app uses 3000).
// It talks to the admin backend (admin-server.js, port 5100) unless VITE_API_URL says otherwise; the
// shared API core's own default is the borrower backend, so the admin default is set here.
const ADMIN_API_DEFAULT = 'http://localhost:5100/api';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || ADMIN_API_DEFAULT),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
