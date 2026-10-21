import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';

// Item 50 follow-up: a failed /api/settings load left `settings` at defaultSettings,
// and Save (or the Dashboard's auto-save on widget reorder) then POSTed every default
// over the real row.

beforeEach(() => {
  useSettingsStore.setState({ settingsLoaded: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('handleSaveSettings', () => {
  it('posts nothing and tells the user when settings never loaded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await useSettingsStore.getState().fetchSettings(); // network failure on load
    expect(useSettingsStore.getState().settingsLoaded).toBe(false);

    const toast = vi.spyOn(useUIStore.getState(), 'showToast');
    fetchSpy.mockClear();
    await useSettingsStore.getState().handleSaveSettings();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("haven't loaded"), 'error');
  });

  it('saves normally once settings have loaded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"timezone":"Europe/London"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));
    await useSettingsStore.getState().fetchSettings();
    expect(useSettingsStore.getState().settingsLoaded).toBe(true);

    await useSettingsStore.getState().handleSaveSettings();
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/settings', expect.objectContaining({ method: 'POST' }));
  });
});
