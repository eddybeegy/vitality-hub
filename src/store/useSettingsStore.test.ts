import { describe, it, expect, vi, afterEach } from 'vitest';
import { useSettingsStore } from './useSettingsStore';

const respond = (body: string, status: number) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.restoreAllMocks());

// Item 58 follow-up: fetchSettings/fetchTargets used .json() without checking res.ok.
describe('fetchSettings on a failed response', () => {
  it('leaves settings untouched instead of merging the error body into them', async () => {
    const before = useSettingsStore.getState().settings;
    respond('{"error":"db down"}', 500);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await useSettingsStore.getState().fetchSettings();
    const after = useSettingsStore.getState().settings as any;
    expect(after).toBe(before);
    expect(after.error).toBeUndefined();
  });

  it('still merges a good response', async () => {
    respond('{"timezone":"Europe/London","show_debug_logs":1}', 200);
    await useSettingsStore.getState().fetchSettings();
    const s = useSettingsStore.getState().settings;
    expect(s.timezone).toBe('Europe/London');
    expect(s.show_debug_logs).toBe(true);
  });
});

describe('fetchTargets on a failed response', () => {
  it('does not mark targets loaded, so handleSaveTargets cannot save over them', async () => {
    useSettingsStore.setState({ targetsLoaded: false });
    respond('{"error":"db down"}', 500);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await useSettingsStore.getState().fetchTargets();
    expect(useSettingsStore.getState().targetsLoaded).toBe(false);
  });
});
