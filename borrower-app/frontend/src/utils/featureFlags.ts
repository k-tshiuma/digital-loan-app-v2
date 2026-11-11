/// <reference types="vite/client" />
// The classic 9-step wizard lets an applicant skip the Back Office approvals of the 3-step flow,
// so its entry link is hidden unless VITE_ENABLE_CLASSIC_FLOW=true. The code and its tests stay.
// Read at call time (not at import) so tests can change it with vi.stubEnv.
export function isClassicFlowEnabled(): boolean {
  return String(import.meta.env.VITE_ENABLE_CLASSIC_FLOW ?? '').trim().toLowerCase() === 'true';
}
