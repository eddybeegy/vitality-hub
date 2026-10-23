import { describe, expect, it } from 'vitest';
import { buildSettingsUpdate, hasSettingsField } from './settingsUpdate';

// No database here: these exercise the body -> [column, value] mapping only. Nothing in
// this file can touch a real settings row.

describe('buildSettingsUpdate — body shape', () => {
  it.each([
    ['an array', [1, 2, 3]],
    ['null', null],
    ['a string', 'email=x'],
    ['a number', 42],
  ])('rejects %s (the item-50 array body that wiped 18 columns)', (_label, body) => {
    expect(buildSettingsUpdate(body).error).toMatch(/JSON object/);
  });

  it('writes only the keys present', () => {
    expect(buildSettingsUpdate({ font_size: 'large' }).columns).toEqual([['font_size', 'large']]);
  });

  it('writes nothing for an empty object, never a default', () => {
    expect(buildSettingsUpdate({}).columns).toEqual([]);
  });

  it('ignores keys that are not settings columns (role, approved, password_hash, ...)', () => {
    const r = buildSettingsUpdate({ role: 'admin', approved: 1, password_hash: 'x', id: 7, ai_configs: [], font_size: 'small' });
    expect(r.columns).toEqual([['font_size', 'small']]);
  });

  it('treats an explicit undefined as absent', () => {
    expect(buildSettingsUpdate({ email: undefined }).columns).toEqual([]);
  });

  it('hasSettingsField sees only real columns', () => {
    expect(hasSettingsField({ role: 'admin' })).toBe(false);
    expect(hasSettingsField({ timezone: null })).toBe(true);
  });
});

describe('buildSettingsUpdate — values are validated, not coerced', () => {
  it.each([
    ['email', ''],
    ['email', 'not-an-email'],
    ['sync_history_days', '30'],
    ['sync_history_days', 0],
    ['sync_history_days', 3651],
    ['sync_history_days', 1.5],
    ['readiness_recovery_days', 31],
    ['age', -1],
    ['dob', '1990-02-30'],
    ['height', 180],
    ['display_mode', 'dark'],
    ['font_size', 'huge'],
    ['preferred_units', 'furlongs'],
    ['default_graph_range', '2w'],
    ['default_graph_grouping', 'year'],
    ['timezone', 'Mars/Olympus_Mons'],
    ['ai_provider', ''],
    ['ai_persona', null],
    ['show_debug_logs', 'yes'],
    ['meal_suggestion_lunch', 2],
    ['medications', 'aspirin'],
    ['medications', [{ name: 5 }]],
    ['dashboard_widgets', 'charts'],
    ['dashboard_widgets', [1]],
    ['ai_generation_times', '["off","off"]'],
    ['ai_generation_times', '["25:00","off","off"]'],
    ['ai_generation_times', ['off', 'off', 'off']],
    ['metric_priorities', '{"weight":"withings"}'],
    ['metric_priorities', 'not json'],
    ['metric_priorities', '[]'],
    ['hevy_api_key', 12345],
  ])('rejects %s = %j', (col, v) => {
    expect(buildSettingsUpdate({ [col]: v }).error).toMatch(new RegExp(col));
  });

  it('one bad value rejects the whole body — nothing is half-written', () => {
    const r = buildSettingsUpdate({ font_size: 'small', display_mode: 'dark' });
    expect(r.columns).toBeUndefined();
    expect(r.error).toMatch(/display_mode/);
  });

  it('accepts what the Settings form actually sends', () => {
    const r = buildSettingsUpdate({
      email: 'k@example.com',
      name: 'Kieron',
      sync_history_days: 90,
      age: null,
      dob: '1990-05-01',
      gender: 'male',
      height: 1.8,
      display_mode: 'auto',
      ai_provider: 'claude',
      ai_base_url: '',
      ai_hints: null,
      ai_persona: 'Encouraging Coach',
      ai_focus: 'General Health',
      meal_suggestion_breakfast: true,
      meal_suggestion_lunch: false,
      meal_suggestion_dinner: 1,
      show_debug_logs: false,
      ai_model: '',
      medications: [{ name: 'Vitamin D', dose: '1000IU', frequency: 'daily' }],
      preferred_units: 'stone',
      default_graph_range: '90d',
      default_graph_grouping: 'week',
      timezone: 'Europe/London',
      ai_generation_times: '["08:00","off","20:00"]',
      metric_priorities: '{"weight":["withings","apple_health"]}',
      font_size: 'medium',
      dashboard_widgets: ['stats', 'charts'],
      readiness_recovery_days: 3,
    });
    expect(r.error).toBeUndefined();
    const cols = Object.fromEntries(r.columns!);
    expect(cols.meal_suggestion_breakfast).toBe(1);
    expect(cols.meal_suggestion_lunch).toBe(0);
    expect(cols.medications).toBe('[{"name":"Vitamin D","dose":"1000IU","frequency":"daily"}]');
    expect(cols.dashboard_widgets).toBe('["stats","charts"]');
    expect(cols.ai_base_url).toBeNull();
    expect(cols.age).toBeNull();
  });

  it('keeps the old "0 height means unset" behaviour', () => {
    expect(buildSettingsUpdate({ height: 0 }).columns).toEqual([['height', null]]);
  });

  it('clears a nullable column on an explicit null', () => {
    expect(buildSettingsUpdate({ metric_priorities: null }).columns).toEqual([['metric_priorities', null]]);
  });
});

describe('buildSettingsUpdate — against the stored row', () => {
  it('skips a value equal to what is stored, even one the rules would now refuse', () => {
    // A legacy display_mode round-tripped from GET must not block saving font_size.
    const r = buildSettingsUpdate({ display_mode: 'dark', font_size: 'large' }, { display_mode: 'dark', font_size: 'medium' });
    expect(r.columns).toEqual([['font_size', 'large']]);
  });

  it('still validates a changed value', () => {
    expect(buildSettingsUpdate({ display_mode: 'dark' }, { display_mode: 'auto' }).error).toMatch(/display_mode/);
  });
});

describe('buildSettingsUpdate — credentials', () => {
  it('blank or null means leave untouched', () => {
    expect(buildSettingsUpdate({ hevy_api_key: '', ai_api_key: null, withings_client_secret: '' }).columns).toEqual([]);
  });

  it('a non-empty value is written', () => {
    expect(buildSettingsUpdate({ ai_api_key: 'sk-1' }).columns).toEqual([['ai_api_key', 'sk-1']]);
  });
});

// Sweep item 86: `enable_correlations` existed as a column, a store default and an
// ActivityTab gate, but was absent from FIELDS -- POST /api/settings accepted the body
// and silently dropped it, so once the flag was 0 nothing in the product could set it
// back to 1.
describe('enable_correlations', () => {
  it('writes the column for true, false and the raw 0/1 a GET round-trips', () => {
    for (const [sent, stored] of [[true, 1], [false, 0], [1, 1], [0, 0]] as const) {
      const r = buildSettingsUpdate({ enable_correlations: sent });
      expect(r.error).toBeUndefined();
      expect(Object.fromEntries(r.columns!)).toEqual({ enable_correlations: stored });
    }
  });

  it('rejects a non-boolean rather than coercing it', () => {
    expect(buildSettingsUpdate({ enable_correlations: 'yes' }).error).toMatch(/enable_correlations/);
  });

  it('leaves the column alone when the body does not mention it', () => {
    const r = buildSettingsUpdate({ font_size: 'large' });
    expect(Object.keys(Object.fromEntries(r.columns!))).toEqual(['font_size']);
  });
});

// Item 95: the alert_* columns. The point of these is that the thresholds are
// editable at all -- the defaults are tuned to one person's readings, so a column
// missing from FIELDS would silently drop the save (the item-86 failure).
describe('alert settings', () => {
  it('accepts every alert column', () => {
    const body = {
      alerts_enabled: true,
      alert_stale_enabled: false,
      alert_bp_enabled: true,
      alert_readiness_enabled: false,
      alert_bp_systolic: 135,
      alert_bp_diastolic: 85,
      alert_readiness_floor: 55,
      alert_quiet_start_hour: 23,
      alert_quiet_end_hour: 6,
    };
    const r = buildSettingsUpdate(body);
    expect(r.error).toBeUndefined();
    expect(Object.fromEntries(r.columns!)).toEqual({
      alerts_enabled: 1,
      alert_stale_enabled: 0,
      alert_bp_enabled: 1,
      alert_readiness_enabled: 0,
      alert_bp_systolic: 135,
      alert_bp_diastolic: 85,
      alert_readiness_floor: 55,
      alert_quiet_start_hour: 23,
      alert_quiet_end_hour: 6,
    });
  });

  it('accepts 0/1 for the flags, as a raw GET returns them', () => {
    const r = buildSettingsUpdate({ alerts_enabled: 1, alert_bp_enabled: 0 });
    expect(Object.fromEntries(r.columns!)).toEqual({ alerts_enabled: 1, alert_bp_enabled: 0 });
  });

  it('rejects an out-of-range quiet hour', () => {
    expect(buildSettingsUpdate({ alert_quiet_start_hour: 24 }).error).toMatch(/alert_quiet_start_hour/);
  });

  it('rejects a BP threshold outside the plausible band', () => {
    expect(buildSettingsUpdate({ alert_bp_systolic: 20 }).error).toMatch(/alert_bp_systolic/);
    expect(buildSettingsUpdate({ alert_bp_diastolic: 300 }).error).toMatch(/alert_bp_diastolic/);
  });

  it('rejects a non-integer readiness floor', () => {
    expect(buildSettingsUpdate({ alert_readiness_floor: 60.5 }).error).toMatch(/alert_readiness_floor/);
  });

  it('rejects a string where a flag is expected', () => {
    expect(buildSettingsUpdate({ alerts_enabled: 'yes' }).error).toMatch(/alerts_enabled/);
  });

  it('leaves alert columns alone when the body omits them', () => {
    const r = buildSettingsUpdate({ font_size: 'large' });
    expect(r.columns!.map(([c]) => c)).toEqual(['font_size']);
  });
});
