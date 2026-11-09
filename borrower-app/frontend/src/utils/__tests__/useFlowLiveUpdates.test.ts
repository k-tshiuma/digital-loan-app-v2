import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFlowLiveUpdates } from '../useFlowLiveUpdates';
import { apiService } from '../../services/api';

/** A stand-in for EventSource: an EventTarget with close(). */
function fakeStream() {
  const target = new EventTarget() as EventTarget & { close: ReturnType<typeof vi.fn> };
  target.close = vi.fn();
  return target;
}

describe('useFlowLiveUpdates', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls onStatus for a status change and onUpdated for other changes', () => {
    const stream = fakeStream();
    const open = vi.spyOn(apiService, 'openApplicationEvents').mockReturnValue(stream as unknown as EventSource);
    const onStatus = vi.fn();
    const onUpdated = vi.fn();
    renderHook(() => useFlowLiveUpdates('app_1', { onStatus, onUpdated }));

    expect(open).toHaveBeenCalledWith('app_1');
    stream.dispatchEvent(new Event('status'));
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onUpdated).not.toHaveBeenCalled();
    stream.dispatchEvent(new Event('updated'));
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it('opens nothing without an application', () => {
    const open = vi.spyOn(apiService, 'openApplicationEvents');
    renderHook(() => useFlowLiveUpdates(null, { onStatus: vi.fn(), onUpdated: vi.fn() }));
    expect(open).not.toHaveBeenCalled();
  });

  it('closes the stream when the screen goes away, and reopens it for another application', () => {
    const first = fakeStream();
    const second = fakeStream();
    vi.spyOn(apiService, 'openApplicationEvents').mockReturnValueOnce(first as unknown as EventSource).mockReturnValueOnce(second as unknown as EventSource);
    const handlers = { onStatus: vi.fn(), onUpdated: vi.fn() };
    const { rerender, unmount } = renderHook(({ id }) => useFlowLiveUpdates(id, handlers), { initialProps: { id: 'app_1' } });

    rerender({ id: 'app_2' });
    expect(first.close).toHaveBeenCalled();
    first.dispatchEvent(new Event('status'));
    expect(handlers.onStatus).not.toHaveBeenCalled(); // the old stream no longer reaches the screen

    unmount();
    expect(second.close).toHaveBeenCalled();
  });

  it('uses the newest handlers without reopening the stream', () => {
    const stream = fakeStream();
    const open = vi.spyOn(apiService, 'openApplicationEvents').mockReturnValue(stream as unknown as EventSource);
    const firstHandler = vi.fn();
    const newerHandler = vi.fn();
    const { rerender } = renderHook(({ onStatus }) => useFlowLiveUpdates('app_1', { onStatus, onUpdated: vi.fn() }), { initialProps: { onStatus: firstHandler } });
    rerender({ onStatus: newerHandler });

    stream.dispatchEvent(new Event('status'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(newerHandler).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the browser has no EventSource (or no session)', () => {
    vi.spyOn(apiService, 'openApplicationEvents').mockReturnValue(null);
    expect(() => renderHook(() => useFlowLiveUpdates('app_1', { onStatus: vi.fn(), onUpdated: vi.fn() }))).not.toThrow();
  });
});
