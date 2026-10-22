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

describe('applyTargetValues', () => {
  const seed = () =>
    useSettingsStore.setState({
      targetsLoaded: true,
      targets: [
        { type: 'calories', label: 'Daily Calories', unit: 'kcal', value: 2055 },
        { type: 'protein', label: 'Daily Protein', unit: 'g', value: 160 },
        { type: 'carbs', label: 'Daily Carbs', unit: 'g', value: 185 },
      ],
    });

  it('writes only the named targets and sends the whole set', async () => {
    seed();
    const fetchMock = respond('{"success":true}', 200);
    await expect(useSettingsStore.getState().applyTargetValues({ calories: 2400, protein: 175 })).resolves.toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.targets).toEqual([
      { type: 'calories', label: 'Daily Calories', unit: 'kcal', value: 2400 },
      { type: 'protein', label: 'Daily Protein', unit: 'g', value: 175 },
      { type: 'carbs', label: 'Daily Carbs', unit: 'g', value: 185 },
    ]);
    expect(useSettingsStore.getState().targets.map(t => t.value)).toEqual([2400, 175, 185]);
  });

  it('leaves local state alone when the server refuses it', async () => {
    seed();
    respond('{"error":"target calories: value must be between 0 and 1000000"}', 400);
    await expect(useSettingsStore.getState().applyTargetValues({ calories: -1 })).resolves.toBe(false);
    expect(useSettingsStore.getState().targets[0].value).toBe(2055);
  });

  it('refuses before targets have loaded, so it cannot write defaults over the real rows', async () => {
    seed();
    useSettingsStore.setState({ targetsLoaded: false });
    const fetchMock = respond('{"success":true}', 200);
    await expect(useSettingsStore.getState().applyTargetValues({ calories: 2400 })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown target type rather than dropping it silently', async () => {
    seed();
    const fetchMock = respond('{"success":true}', 200);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useSettingsStore.getState().applyTargetValues({ calores: 2400 } as any)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
