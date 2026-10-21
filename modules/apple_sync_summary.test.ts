import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppleHealthModule, appleSyncSummaryPath } from './apple_health';

// Sweep item 47: the Logs tab's "Raw Metrics Received" table was permanently empty
// because nothing ever wrote the file it reads. These cover the writer, so a future
// refactor that drops it fails here instead of silently emptying the panel again.
const stubDb = () => ({
  prepare: () => ({ run: async () => {}, get: async () => null, all: async () => [] }),
  transaction: (fn: Function) => async () => { await fn(); },
});

const origCwd = process.cwd();
let tmp: string | null = null;

afterEach(() => {
  process.chdir(origCwd);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

const runSync = async (metrics: any[]) => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-sync-'));
  process.chdir(tmp);
  const res = await AppleHealthModule.sync(1, stubDb(), () => {}, {}, { data: { metrics } });
  const file = appleSyncSummaryPath(1);
  return { res, file, summary: JSON.parse(fs.readFileSync(file, 'utf-8')) };
};

describe('Apple Health sync summary (item 47)', () => {
  it('records every raw name it saw, with its mapping and stored-value count', async () => {
    const { res, file, summary } = await runSync([
      {
        name: 'Active Energy',
        units: 'kcal',
        data: [
          { date: '2026-10-21 08:00:00 +0100', qty: 120 },
          { date: '2026-10-21 09:00:00 +0100', qty: 140 },
        ],
      },
      { name: 'Totally Unknown Metric', units: 'count', data: [{ date: '2026-10-21 09:00:00 +0100', qty: 1 }] },
    ]);

    expect(res.success).toBe(true);
    // The file must land under `data/` -- the only persistent mount in the container.
    expect(path.basename(path.dirname(file))).toBe('data');
    expect(summary.rawNames).toEqual(['Active Energy', 'Totally Unknown Metric']);

    const active = summary.names.find((n: any) => n.raw === 'Active Energy');
    expect(active.mappedTo).toBe('active_energy');
    expect(active.points).toBe(2);
    expect(active.noValue).toBe(false);

    const unknown = summary.names.find((n: any) => n.raw === 'Totally Unknown Metric');
    expect(unknown.mappedTo).toBeNull();
    expect(unknown.points).toBe(0);

    expect(summary.count).toBe(2);
    expect(Date.parse(summary.lastSync)).not.toBeNaN();
  });

  it('flags a mapped metric whose data points carry no recognised value key', async () => {
    const { summary } = await runSync([
      { name: 'Step Count', units: 'count', data: [{ date: '2026-10-21 09:00:00 +0100', somethingElse: 5 }] },
    ]);

    const stat = summary.names[0];
    expect(stat.mappedTo).toBeTruthy();
    expect(stat.noValue).toBe(true);
    expect(stat.points).toBe(0);
    expect(summary.count).toBe(0);
  });
});
