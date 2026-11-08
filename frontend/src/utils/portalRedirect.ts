// The Back Office is its own app now. Old links to /backoffice or /admin on the borrower site are sent there.
export const ADMIN_APP_URL: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ADMIN_URL) || 'http://localhost:3001';

export function goToAdminPortal(): void {
  window.location.replace(ADMIN_APP_URL);
}
