// Where the borrower app runs (for the staff login page's "back to the public site" link).
export const BORROWER_APP_URL: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BORROWER_URL) || 'http://localhost:3000';
