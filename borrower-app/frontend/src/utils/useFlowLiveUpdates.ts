import { useEffect, useRef } from 'react';
import { apiService } from '../services/api';

/**
 * Keeps the 3-step flow screens current while they are open. Listens to the application's live stream
 * (GET /api/applications/:id/events; staff changes made in the admin process arrive through the borrower
 * API's status poller) and calls:
 * - onStatus when the status changed (a staff decision): reload and move to the right step or the hub
 * - onUpdated when only the data changed (a staff message, a save): reload without leaving the screen
 * Does nothing without an application id or where EventSource is unavailable. The browser reconnects
 * on its own after a dropped connection.
 */
export function useFlowLiveUpdates(applicationId: string | null | undefined, handlers: { onStatus: () => void; onUpdated: () => void }) {
  // The latest handlers, so the stream isn't reopened on every render.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!applicationId) return;
    const source = apiService.openApplicationEvents(applicationId);
    if (!source) return;
    const onStatus = () => latest.current.onStatus();
    const onUpdated = () => latest.current.onUpdated();
    source.addEventListener('status', onStatus);
    source.addEventListener('updated', onUpdated);
    return () => {
      source.removeEventListener('status', onStatus);
      source.removeEventListener('updated', onUpdated);
      source.close();
    };
  }, [applicationId]);
}
