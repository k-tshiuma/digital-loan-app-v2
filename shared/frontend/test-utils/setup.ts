// Test setup shared by every frontend suite. An app's own setup imports its appMessages first, then this.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no canvas. Give components (e.g. the signature pad) a do-nothing 2D context.
HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: (_t, prop) => (prop === 'canvas' ? this : () => undefined) });
} as any;
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // storage may be stubbed to throw in some tests
  }
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});
